import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@/generated/prisma/client";

process.env.MAILBOX_ID = "owner@gfs.test";
process.env.AZURE_TENANT_ID = "t";
process.env.AZURE_CLIENT_ID = "c";
process.env.AZURE_CLIENT_SECRET = "s";
process.env.SHAREPOINT_DRIVE_ID = "drive1";

let pg: PGlite;
let db: PrismaClient;
let processEmailEvent: typeof import("./intake").processEmailEvent;
const enqueued: string[] = [];
const uploads: string[] = [];
let graphDown = false;

const pdf = (tag: string) => Buffer.from(`%PDF-1.7\n% ${tag}\n%%EOF\n`);
const hundred = Array.from({ length: 100 }, (_, i) => ({ id: `b${i}`, name: `SC-${i}.pdf`, type: "application/pdf", body: pdf(`batch-${i}`) }));
const MESSAGES: Record<string, { hasAttachments: boolean; atts: { id: string; name: string; type: string; body: Buffer; inline?: boolean; odata?: string }[] }> = {
  plain: { hasAttachments: false, atts: [] },
  batch: { hasAttachments: true, atts: hundred },
  multi: {
    hasAttachments: true,
    atts: [
      { id: "a1", name: "SC-100.pdf", type: "application/pdf", body: pdf("one") },
      { id: "a2", name: "SC-101.pdf", type: "application/pdf", body: pdf("two") },
      { id: "a3", name: "photo.jpg", type: "image/jpeg", body: Buffer.from("jpg") },
      { id: "a4", name: "fake.pdf", type: "application/pdf", body: Buffer.from("not a pdf at all") },
    ],
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

before(async () => {
  pg = new PGlite();
  await pg.exec(readFileSync("prisma/migrations/0001_init/migration.sql", "utf8"));
  db = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("oauth2/v2.0/token")) return json({ access_token: "tok", expires_in: 3600 });
    if (graphDown) return json({ error: { code: "serviceNotAvailable" } }, 503);
    const m = /messages\/([^/?]+)(\/attachments(?:\/([^/?]+)\/\$value)?)?/.exec(decodeURIComponent(url));
    if (m && !url.includes("/drives/")) {
      const msg = MESSAGES[m[1]];
      if (!msg) return json({}, 404);
      if (!m[2]) return json({ id: m[1], conversationId: "conv1", hasAttachments: msg.hasAttachments, isDraft: false });
      if (m[3]) return new Response(new Uint8Array(msg.atts.find((a) => a.id === m[3])!.body));
      return json({ value: msg.atts.map((a) => ({ id: a.id, name: a.name, size: a.body.length, contentType: a.type, isInline: false, "@odata.type": "#microsoft.graph.fileAttachment" })) });
    }
    if (url.includes("/drives/drive1/root:") && init?.method === "PUT") {
      uploads.push(decodeURIComponent(url));
      return json({ id: `item-${uploads.length}`, size: 1 });
    }
    return json({ error: { code: "unexpected" } }, 500);
  }) as typeof fetch;

  const mb = await db.mailboxConnection.create({ data: { mailboxId: "owner@gfs.test", tenantId: "t" } });
  for (const id of ["plain", "multi", "batch"]) {
    await db.incomingEvent.create({
      data: { id: `ev-${id}`, mailboxId: mb.id, dedupeKey: `msg|${id}`, kind: "message.created", graphMessageId: id, subscriptionId: "s", payload: {} },
    });
  }
  ({ processEmailEvent } = await import("./intake"));
});

after(async () => {
  await db.$disconnect();
  await pg.close();
});

const enqueue = async (id: string) => void enqueued.push(id);

test("an ordinary email without attachments is ignored", async () => {
  const r = await processEmailEvent("ev-plain", enqueue);
  assert.deepEqual(r, { ignored: "no attachments" });
  assert.equal(await db.contract.count(), 0);
  assert.equal(enqueued.length, 0);
});

test("only genuine PDFs become contracts; each is stored and queued independently", async () => {
  const r = (await processEmailEvent("ev-multi", enqueue)) as { contracts: string[] };
  assert.equal(r.contracts.length, 2);
  assert.equal(await db.contract.count(), 2);
  assert.equal(enqueued.length, 2);
  assert.equal(uploads.length, 2);
  const docs = await db.documentRef.findMany();
  assert.ok(docs.every((d) => d.kind === "ORIGINAL" && /^[0-9a-f]{64}$/.test(d.sha256)));
  assert.ok((await db.auditEvent.count({ where: { action: "attachment:rejected-not-pdf" } })) === 1);
});

test("replaying a processed event does nothing", async () => {
  const r = await processEmailEvent("ev-multi", enqueue);
  assert.deepEqual(r, { skipped: "already processed" });
  assert.equal(await db.contract.count(), 2);
  assert.equal(enqueued.length, 2);
});

test("a temporary Graph failure throws as retryable and leaves no partial contract", async () => {
  await db.incomingEvent.create({
    data: { id: "ev-retry", mailboxId: (await db.mailboxConnection.findFirstOrThrow()).id, dedupeKey: "msg|retry", kind: "message.created", graphMessageId: "multi2", subscriptionId: "s", payload: {} },
  });
  graphDown = true;
  const { GraphError } = await import("./graph");
  await assert.rejects(processEmailEvent("ev-retry", enqueue), (e: unknown) => e instanceof GraphError && e.retryable);
  assert.equal(await db.contract.count(), 2);
  graphDown = false;
});

test("a batch of 100 contracts in one email is queued once each, with no duplicates on replay", async () => {
  const start = enqueued.length;
  const r = (await processEmailEvent("ev-batch", enqueue)) as { contracts: string[] };
  assert.equal(r.contracts.length, 100);
  assert.equal(new Set(enqueued.slice(start)).size, 100);
  await processEmailEvent("ev-batch", enqueue);
  assert.equal(enqueued.length - start, 100);
  assert.equal(await db.contract.count({ where: { graphMessageId: "batch" } }), 100);
});
