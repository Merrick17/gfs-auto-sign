import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  await pg.exec(readFileSync("prisma/migrations/0001_init/migration.sql", "utf8"));
  db = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  globalThis.fetch = (async (i: string | URL | Request, init?: RequestInit) => fakeGraph(i, init)) as typeof fetch;
  ({ createReplyDraft } = await import("./drafts"));
});

after(async () => {
  await db.$disconnect();
  await pg.close();
});

const FULL = {
  isSalesContract: true, customer: "Acme GmbH", contractNumber: "SC", version: "1", contractDate: null, currency: "EUR", amount: 1, contractType: null,
  language: "en", articles: [], paymentTerms: null, deliveryTerms: null, obligations: [], unusualCommitments: [], existingSignatures: [],
  gfsSignatureLocations: [], inconsistencies: [], missingFields: [], historyDeviations: [], promptInjectionSuspected: false, confidence: 0.9, evidence: [],
};
let seq = 0;
async function seedContract() {
  seq++;
  const mb = (await db.mailboxConnection.findFirst()) ?? (await db.mailboxConnection.create({ data: { mailboxId: "owner@gfs.test", tenantId: "t" } }));
  if (!(await db.signingPolicy.findFirst())) {
    await db.signingPolicy.create({
      data: {
        version: 1, active: true, autonomousSigningEnabled: true, createdBy: "t",
        rules: { minConfidence: 0.8, mandatoryReviewKeywords: [], customers: [{ name: "Acme GmbH", currency: "EUR", maxAmount: 1e6, replyTo: ["buyer@acme.test"], cc: ["sales@gfs.test", "boss@gfs.test"], contractTypes: [], paymentTerms: [], deliveryTerms: [], instructions: "" }] },
      },
    });
  }
  const c = await db.contract.create({
    data: { mailboxId: mb.id, graphMessageId: `msg${seq}`, attachmentId: "a", attachmentName: "SC.pdf", contentHash: `h${seq}`, customer: "Acme GmbH", contractNumber: `SC-${seq}`, status: "STORED" },
  });
  await db.documentRef.create({ data: { contractId: c.id, kind: "SIGNED", driveId: "drive1", itemId: "signed1", sha256: sha256(signedBytes) } });
  await db.contractAnalysis.create({
    data: { contractId: c.id, model: "m", decision: "APPROVE", reasons: [], result: FULL },
  });
  return c.id;
}

beforeEach(() => {
  drafts = [];
  requests = [];
});

test("creates one reply draft with configured To/CC, attaches the signed PDF, never sends", async () => {
  const id = await seedContract();
  await createReplyDraft(id);
  assert.equal(drafts.length, 1);
  assert.deepEqual(drafts[0].to, ["buyer@acme.test"]);
  assert.deepEqual(drafts[0].cc, ["sales@gfs.test", "boss@gfs.test"]);
  assert.deepEqual(drafts[0].attachments.map((a) => a.name), ["signed-SC.pdf"]);
  assert.match(drafts[0].body, /SC-\d+/);
  assert.match(drafts[0].body, /quoted original/);
  assert.equal(requests.filter((r) => /send/i.test(r)).length, 0);
  const c = await db.contract.findUniqueOrThrow({ where: { id }, include: { draft: true } });
  assert.equal(c.status, "DRAFT_READY");
  assert.equal(c.draft?.state, "ATTACHED");
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
  assert.deepEqual(drafts[0].cc, ["sales@gfs.test", "boss@gfs.test"]);
  assert.equal(drafts[0].attachments.length, 1);
  assert.equal(drafts[0].body.match(/gfs-reply/g)?.length, 1);
});

test("a failed recipient update is repaired on retry without duplicating anything", async () => {
  const id = await seedContract();
  failNextPatch = true;
  await assert.rejects(createReplyDraft(id));
  await createReplyDraft(id);
  assert.equal(drafts.length, 1);
  assert.deepEqual(drafts[0].to, ["buyer@acme.test"]);
  assert.equal(drafts[0].attachments.length, 1);
});
