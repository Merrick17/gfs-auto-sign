import { migrationSql, seedOAuth } from "./test-db";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@/generated/prisma/client";
import { sha256 } from "./sharepoint";

process.env.MAILBOX_ID = "owner@gfs.test";
process.env.AZURE_TENANT_ID = "t";
process.env.AZURE_CLIENT_ID = "c";
process.env.AZURE_CLIENT_SECRET = "s";
process.env.SHAREPOINT_DRIVE_ID = "drive1";
delete process.env.OPENAI_API_KEY;

type Draft = { id: string; marker?: string; body: string; to: string[]; cc: string[]; attachments: { id: string; name: string }[] };
let pg: PGlite;
let db: PrismaClient;
let createReplyDraft: typeof import("./drafts").createReplyDraft;
let drafts: Draft[] = [];
let requests: string[] = [];
let loseCreateResponse = false;
let failNextPatch = false;
const signedBytes = Buffer.from("%PDF-1.7\nsigned\n%%EOF");

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

function fakeGraph(input: string | URL | Request, init?: RequestInit): Response {
  const url = decodeURIComponent(String(input instanceof Request ? input.url : input));
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  requests.push(`${method} ${url.split("?")[0]}`);
  if (url.includes("oauth2/v2.0/token")) return json({ access_token: "tok", expires_in: 3600 });
  if (url.includes("/drives/drive1/items/signed1/content")) return new Response(new Uint8Array(signedBytes));

  if (method === "POST" && url.endsWith("/createReply")) {
    const d: Draft = { id: `draft-${drafts.length + 1}`, marker: body?.message?.singleValueExtendedProperties?.[0]?.value, body: "<p>quoted original</p>", to: ["sender@customer.test"], cc: [], attachments: [] };
    drafts.push(d);
    if (loseCreateResponse) {
      loseCreateResponse = false;
      return json({ error: { code: "serviceNotAvailable" } }, 503); // created server-side, caller never learns
    }
    return json({ id: d.id, body: { contentType: "html", content: d.body } });
  }
  if (method === "GET" && url.includes("mailFolders('Drafts')/messages")) {
    const m = /ep\/value eq '([^']+)'/.exec(url);
    const hit = drafts.find((d) => d.marker === m?.[1]);
    return json({ value: hit ? [{ id: hit.id, body: { contentType: "html", content: hit.body } }] : [] });
  }
  const one = /\/messages\/(draft-\d+)(\/attachments)?/.exec(url);
  if (one) {
    const d = drafts.find((x) => x.id === one[1])!;
    if (method === "GET" && !one[2]) return json({ id: d.id, body: { contentType: "html", content: d.body } });
    if (method === "PATCH") {
      if (failNextPatch) {
        failNextPatch = false;
        return json({ error: { code: "serviceNotAvailable" } }, 503);
      }
      d.body = body.body.content;
      if (body.toRecipients) d.to = body.toRecipients.map((r: { emailAddress: { address: string } }) => r.emailAddress.address);
      d.cc = body.ccRecipients.map((r: { emailAddress: { address: string } }) => r.emailAddress.address);
      return json({ id: d.id });
    }
    if (one[2] && method === "GET") return json({ value: d.attachments });
    if (one[2] && method === "POST") {
      d.attachments.push({ id: `att-${d.attachments.length + 1}`, name: body.name });
      return json({ id: "att" }, 201);
    }
  }
  return json({ error: { code: "unexpected" } }, 500);
}

before(async () => {
  pg = new PGlite();
  await pg.exec(migrationSql());
  db = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  await seedOAuth(db);
  globalThis.fetch = (async (i: string | URL | Request, init?: RequestInit) => fakeGraph(i, init)) as typeof fetch;
  ({ createReplyDraft } = await import("./drafts"));
  await db.senderRule.create({ data: { sender: "@acme.test", to: ["contracts@acme.test"], cc: ["sales@gfs.test", "boss@gfs.test"] } });
  await db.appSetting.create({ data: { key: "draft", value: { message: "Hi <team>,\nsigned copy attached.", cc: ["archive@gfs.test", "sales@gfs.test"] } } });
});

after(async () => {
  await db.$disconnect();
  await pg.close();
});

let seq = 0;
async function seedContract(sender = "buyer@acme.test") {
  seq++;
  const mb = (await db.mailboxConnection.findFirst()) ?? (await db.mailboxConnection.create({ data: { mailboxId: "owner@gfs.test", tenantId: "t" } }));
  const c = await db.contract.create({
    data: { mailboxId: mb.id, graphMessageId: `msg${seq}`, attachmentId: "a", attachmentName: "Agreement.pdf", contentHash: `h${seq}`, senderAddress: sender, status: "SIGNED" },
  });
  await db.documentRef.create({ data: { contractId: c.id, kind: "SIGNED", driveId: "drive1", itemId: "signed1", sha256: sha256(signedBytes) } });
  return c.id;
}

beforeEach(() => {
  drafts = [];
  requests = [];
});

test("the sender rule sets To and CC, the Settings CC is added once, the signed PDF is attached, nothing is sent", async () => {
  const id = await seedContract();
  await createReplyDraft(id);
  assert.equal(drafts.length, 1);
  assert.deepEqual(drafts[0].to, ["contracts@acme.test"]);
  assert.deepEqual(drafts[0].cc, ["sales@gfs.test", "boss@gfs.test", "archive@gfs.test"]);
  assert.deepEqual(drafts[0].attachments.map((a) => a.name), ["Agreement (signed).pdf"]);
  assert.match(drafts[0].body, /Hi &lt;team&gt;,<br>signed copy attached./);
  assert.match(drafts[0].body, /quoted original/);
  assert.equal(requests.filter((r) => /send/i.test(r)).length, 0);
  const c = await db.contract.findUniqueOrThrow({ where: { id }, include: { draft: true } });
  assert.equal(c.status, "DRAFT_SAVED");
  assert.equal(c.draft?.state, "ATTACHED");
  assert.equal(await db.auditEvent.count({ where: { contractId: id, action: "draft-saved" } }), 1);
});

test("an exact-address rule wins over the domain rule; without To the reply goes to the sender", async () => {
  await db.senderRule.create({ data: { sender: "ceo@acme.test", to: [], cc: ["ceo-office@gfs.test"] } });
  const id = await seedContract("ceo@acme.test");
  await createReplyDraft(id);
  assert.deepEqual(drafts[0].to, ["sender@customer.test"]); // Outlook reply default, untouched
  assert.deepEqual(drafts[0].cc, ["ceo-office@gfs.test", "archive@gfs.test", "sales@gfs.test"]);
});

test("re-running creates no second draft or attachment", async () => {
  const id = await seedContract();
  await createReplyDraft(id);
  await createReplyDraft(id);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].attachments.length, 1);
});

test("a lost createReply response is resolved by marker, not by creating another draft", async () => {
  const id = await seedContract();
  loseCreateResponse = true;
  await assert.rejects(createReplyDraft(id));
  assert.equal(drafts.length, 1); // exists server-side
  await createReplyDraft(id);
  assert.equal(drafts.length, 1);
  assert.deepEqual(drafts[0].to, ["contracts@acme.test"]);
  assert.equal(drafts[0].attachments.length, 1);
  assert.equal(drafts[0].body.match(/gfs-reply/g)?.length, 1);
});

test("a failed recipient update is repaired on retry without duplicating anything", async () => {
  const id = await seedContract();
  failNextPatch = true;
  await assert.rejects(createReplyDraft(id));
  await createReplyDraft(id);
  assert.equal(drafts.length, 1);
  assert.deepEqual(drafts[0].to, ["contracts@acme.test"]);
  assert.equal(drafts[0].attachments.length, 1);
});
