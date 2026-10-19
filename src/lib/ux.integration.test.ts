import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import forge from "node-forge";
import { PDFDocument } from "pdf-lib";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@/generated/prisma/client";
import { migrationSql, seedOAuth } from "./test-db";

process.env.AZURE_TENANT_ID = "t";
process.env.AZURE_CLIENT_ID = "c";
process.env.AZURE_CLIENT_SECRET = "s";
process.env.CERT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.AI_MOCK = "1";
delete process.env.APP_BASE_URL;

// 1x1 transparent-ish PNG header padded to a plausible size: width/height are what the validator reads.
function png(width: number, height: number, extra = 0) {
  const b = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
const REAL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let pg: PGlite;
let db: PrismaClient;
let scopes = "Mail.Read Mail.ReadWrite Files.ReadWrite Contacts.Read People.Read";
const requests: string[] = [];
const drive = new Map<string, { bytes: Buffer; path: string; type: string }>();
const OWNER = "owner@gfs.test";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const addr = (a: string, n?: string) => ({ emailAddress: { address: a, name: n ?? "" } });

const SENT_PAGE_2 = [{ id: "m4", conversationId: "conv-z", sentDateTime: "2026-09-01T10:00:00Z", toRecipients: [addr("supplier@z.test", "Zed Supplier")], ccRecipients: [] }];
const SENT_PAGE_1 = [
  { id: "m1", conversationId: "conv-acme", sentDateTime: "2026-10-10T10:00:00Z", toRecipients: [addr("buyer@acme.test", "Acme Buyer")], ccRecipients: [addr("lena@gfs.test", "Lena Commercial"), addr("mark@gfs.test", "Mark Finance"), addr(OWNER)] },
  { id: "m2", conversationId: "conv-acme-2", sentDateTime: "2026-10-05T10:00:00Z", toRecipients: [addr("buyer@acme.test", "Acme Buyer")], ccRecipients: [addr("LENA@gfs.test", "Lena Commercial")] },
  { id: "m3", conversationId: "conv-x", sentDateTime: "2026-09-20T10:00:00Z", toRecipients: [addr("other@else.test", "Other")], ccRecipients: [addr("boss@gfs.test", "The Boss")] },
];

before(async () => {
  pg = new PGlite();
  await pg.exec(migrationSql());
  db = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  await seedOAuth(db);
  await db.oAuthConnection.updateMany({ data: { accountEmail: OWNER, accountName: "Owner" } });

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(input instanceof Request ? input.url : input));
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url}`);
    if (url.includes("oauth2/v2.0/token")) {
      const claims = Buffer.from(JSON.stringify({ scp: scopes })).toString("base64url");
      return json({ access_token: `h.${claims}.s`, expires_in: 3600 });
    }
    if (url.includes("/me/contacts"))
      return json({ value: [
        { id: "oc1", displayName: "Lena Commercial", companyName: "GFS", emailAddresses: [{ address: "lena@gfs.test" }] },
        { id: "oc2", displayName: "Acme Buyer", companyName: "Acme", emailAddresses: [{ address: "buyer@acme.test" }] },
        { id: "oc3", displayName: "Nora Legal", companyName: "GFS", emailAddresses: [{ address: "nora@gfs.test" }, { address: "NORA.legal@gfs.test" }] },
      ] });
    if (url.includes("mailFolders('SentItems')/messages")) {
      if (url.includes("page2")) return json({ value: SENT_PAGE_2 });
      if (url.includes("$filter=")) return json({ value: [] });
      return json({ value: SENT_PAGE_1, "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/mailFolders('SentItems')/messages?page2" });
    }
    if (url.includes("/search/query"))
      return json({ value: [{ hitsContainers: [{ hits: [{ resource: { displayName: "Dir Person", scoredEmailAddresses: [{ address: "dir@gfs.test" }], companyName: "GFS" } }] }] }] });
    if (method === "PUT" && url.includes("/me/drive/root:/")) {
      const path = url.split("/root:/")[1].replace(/:\/content$/, "");
      const id = `item-${drive.size + 1}`;
      drive.set(id, { bytes: Buffer.from(init!.body as Uint8Array), path, type: String((init!.headers as Record<string, string>)["Content-Type"]) });
      return json({ id, size: 1, parentReference: { driveId: "real-drive" } });
    }
    const dl = /\/drives\/real-drive\/items\/([^/]+)\/content/.exec(url);
    if (dl && drive.has(dl[1])) return new Response(new Uint8Array(drive.get(dl[1])!.bytes));
    return json({ error: { code: "unexpected" } }, 500);
  }) as typeof fetch;
});

after(async () => {
  await db.$disconnect();
  await pg.close();
});

// ---- contacts ---------------------------------------------------------------------------------------
test("contact sync merges Outlook contacts and sent mail into one deduplicated index", async () => {
  const { syncContacts, indexStatus } = await import("./contacts");
  const r = await syncContacts();
  assert.equal(r.outlookContacts, 4); // nora has two addresses
  assert.equal(r.sent, 4);
  const lena = await db.contact.findUniqueOrThrow({ where: { email: "lena@gfs.test" } });
  assert.deepEqual([...lena.sources].sort(), ["outlook-contact", "sent"]);
  assert.equal(lena.ccCount, 2, "LENA@ and lena@ are one person");
  assert.equal(lena.organization, "GFS");
  const buyer = await db.contact.findUniqueOrThrow({ where: { email: "buyer@acme.test" } });
  assert.equal(buyer.toCount, 2);
  assert.equal(await db.contact.count({ where: { email: OWNER } }), 0, "the owner is never suggested");
  assert.equal(await db.contact.count({ where: { email: "lena@gfs.test" } }), 1);
  const st = await indexStatus();
  assert.ok(st.contacts >= 7 && st.syncedAt);
});

test("a second sync is incremental and creates no duplicates", async () => {
  const { syncContacts } = await import("./contacts");
  const before_ = await db.contact.count();
  const rows = await db.sentRecipient.count();
  requests.length = 0;
  await syncContacts();
  assert.ok(requests.some((r) => r.includes("sentDateTime gt")), "only mail newer than the last run is requested");
  assert.equal(await db.contact.count(), before_);
  assert.equal(await db.sentRecipient.count(), rows);
});

test("suggestions for a customer rank people actually copied on its correspondence first, with honest labels", async () => {
  const { searchContacts } = await import("./contacts");
  const mb = await db.mailboxConnection.create({ data: { mailboxId: OWNER, tenantId: "t" } });
  await db.contract.create({
    data: { mailboxId: mb.id, graphMessageId: "gm1", attachmentId: "a", attachmentName: "SC.pdf", contentHash: "h", customer: "Acme", conversationId: "conv-acme", senderAddress: "buyer@acme.test" },
  });
  const hits = await searchContacts({ customer: "Acme" });
  assert.equal(hits[0].email, "lena@gfs.test");
  assert.ok(hits[0].labels.includes("Frequently copied for this customer"));
  assert.ok(hits[0].labels.includes("Saved Outlook contact"));
  const mark = hits.find((h) => h.email === "mark@gfs.test")!;
  assert.ok(mark.labels.includes("Copied once on this customer's emails"));
  const buyer = hits.find((h) => h.email === "buyer@acme.test")!;
  assert.ok(buyer.labels.includes("From this customer's company"));
  const boss = hits.find((h) => h.email === "boss@gfs.test");
  assert.ok(!boss || !boss.labels.some((l) => /customer/.test(l)), "no relationship label without evidence");
  assert.ok(hits.findIndex((h) => h.email === "lena@gfs.test") < hits.findIndex((h) => h.email === "mark@gfs.test"));
});

test("search matches partial name, address or organisation, and never offers someone already chosen", async () => {
  const { searchContacts } = await import("./contacts");
  assert.ok((await searchContacts({ query: "comm" })).some((h) => h.email === "lena@gfs.test"));
  assert.ok((await searchContacts({ query: "acme.test" })).some((h) => h.email === "buyer@acme.test"));
  assert.ok((await searchContacts({ query: "GFS" })).length >= 3);
  assert.equal((await searchContacts({ query: "zzzz-nobody" })).length, 0);
  const without = await searchContacts({ customer: "Acme", exclude: ["LENA@gfs.test"] });
  assert.ok(!without.some((h) => h.email === "lena@gfs.test"));
});

test("Microsoft people search adds directory people when allowed", async () => {
  const { searchPeople, searchContacts } = await import("./contacts");
  assert.equal(await searchPeople("dir"), 1);
  const hit = (await searchContacts({ query: "Dir Person" }))[0];
  assert.equal(hit.email, "dir@gfs.test");
  assert.ok(hit.labels.includes("Company directory"));
});

test("contact sync reports missing permissions instead of pretending", async () => {
  const { syncContacts } = await import("./contacts");
  const { storeRefreshToken } = await import("./graph-token");
  scopes = "Mail.Read Mail.ReadWrite Files.ReadWrite";
  await storeRefreshToken("owner-oid", "rt2");
  const r = await syncContacts();
  assert.equal(r.outlookContacts, "no-permission");
  assert.equal(typeof r.sent, "number");
  scopes = "Mail.Read Mail.ReadWrite Files.ReadWrite Contacts.Read People.Read";
  await storeRefreshToken("owner-oid", "rt3");
});

// ---- signature image (OneDrive) ------------------------------------------------------------------------
test("signature images are validated before anything is uploaded", async () => {
  const { inspectPng, SignatureImageError } = await import("./signature-image");
  assert.throws(() => inspectPng(Buffer.from("GIF89a....")), SignatureImageError);
  assert.throws(() => inspectPng(png(60, 20)), /too small/);
  assert.throws(() => inspectPng(png(9000, 100)), /too large/);
  assert.throws(() => inspectPng(png(400, 120, 2_000_000)), /too large/);
  assert.deepEqual(inspectPng(png(400, 120)), { width: 400, height: 120 });
});

test("a signature is stored in the private OneDrive folder, versioned, replaceable and removable", async () => {
  const { saveSignatureImage, readSignatureImage, getActiveSignatureImage, removeSignatureImage } = await import("./signature-image");
  const bytes1 = png(400, 120, 50);
  const v1 = await saveSignatureImage(bytes1, "me.png");
  assert.equal(v1.version, 1);
  assert.equal(v1.driveId, "real-drive");
  const up = [...drive.values()].find((d) => d.path.includes("Signatures"))!;
  assert.match(up.path, /^Apps\/GFS Contract Agent\/Signatures\/signature-v1-[0-9a-f]{8}\.png$/);
  assert.equal(up.type, "image/png");
  assert.ok((await readSignatureImage(v1)).equals(bytes1), "reloading returns the same bytes from OneDrive");

  const v2 = await saveSignatureImage(png(500, 150, 80), "new.png");
  assert.equal(v2.version, 2);
  assert.equal((await getActiveSignatureImage())!.id, v2.id);
  const old = await db.signatureImage.findUniqueOrThrow({ where: { id: v1.id } });
  assert.equal(old.active, false, "the previous version is kept for the audit trail");
  assert.ok((await readSignatureImage(old)).equals(bytes1));

  await removeSignatureImage();
  assert.equal(await getActiveSignatureImage(), null);
  assert.ok((await db.signatureImage.findUniqueOrThrow({ where: { id: v2.id } })).removedAt);
  assert.ok(!(await import("./signature-image")).SIGNATURE_FOLDER.includes("http"), "no public link");
});

test("a tampered OneDrive copy of the signature is refused", async () => {
  const { saveSignatureImage, readSignatureImage } = await import("./signature-image");
  const row = await saveSignatureImage(png(420, 130, 40), "t.png");
  const item = [...drive.entries()].find(([id]) => id === row.itemId)!;
  item[1].bytes = png(420, 130, 41);
  await assert.rejects(readSignatureImage(row), /hash mismatch/);
});

// ---- certificate ---------------------------------------------------------------------------------------
test("a generated or imported certificate can sign, and needs no password from the owner", async () => {
  const { createSelfSigned, importP12, p12Password, CertificateError } = await import("./certificate");
  const { signPdf, verifyPdfSignature } = await import("./pdf-sign");
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const pdf = Buffer.from(await doc.save());
  const loc = { page: 1, x: 0.1, y: 0.8, width: 0.3, height: 0.08 };

  const gen = createSelfSigned({ name: "Test Owner", email: OWNER });
  assert.equal(gen.info.selfSigned, true);
  const s1 = await signPdf({ pdf, p12: gen.p12, passphrase: p12Password(), signaturePng: REAL_PNG, location: loc, signerName: "Test Owner", reason: "t" });
  assert.ok(verifyPdfSignature(s1).valid);

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "02";
  cert.validity.notBefore = new Date(Date.now() - 1e6);
  cert.validity.notAfter = new Date(Date.now() + 1e10);
  cert.setSubject([{ name: "commonName", value: "Imported" }]);
  cert.setIssuer([{ name: "commonName", value: "Imported" }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const theirs = Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], "their-password", { algorithm: "3des" })).getBytes(), "binary");
  const imp = importP12(theirs, "their-password");
  assert.equal(imp.info.commonName, "Imported");
  const s2 = await signPdf({ pdf, p12: imp.p12, passphrase: p12Password(), signaturePng: REAL_PNG, location: loc, signerName: "Imported", reason: "t" });
  assert.ok(verifyPdfSignature(s2).valid);

  assert.throws(() => importP12(theirs, "wrong"), CertificateError);
  assert.throws(() => importP12(Buffer.from("not a certificate"), "x"), CertificateError);
});

// ---- rules & policy -------------------------------------------------------------------------------------
const baseRule = { enabled: true, customerName: "Acme", customerDomains: ["acme.test"], contractType: "sales" as const, maxAmount: 50000, currency: "EUR" as const, paymentTerms: ["30 days"], deliveryTerms: ["FOB"], cc: ["lena@gfs.test"], replyTo: [], instructions: "Friendly tone" };

test("rules compile into versioned policies; unchanged saves do not create versions", async () => {
  const { saveRule, publishPolicy, setRuleEnabled, deleteRule } = await import("./rules");
  const { policyRules } = await import("./policy");
  const saved = await saveRule(baseRule, "owner");
  const p1 = await db.signingPolicy.findFirstOrThrow({ where: { active: true } });
  const c1 = policyRules.parse(p1.rules).customers[0];
  assert.equal(c1.ruleId, saved.id);
  assert.deepEqual(c1.contractTypes, ["sales"]);
  assert.deepEqual(c1.cc, ["lena@gfs.test"]);
  assert.equal(await publishPolicy("owner"), p1.version, "no change, no new version");

  await saveRule({ ...baseRule, id: saved.id, maxAmount: 60000 }, "owner");
  const p2 = await db.signingPolicy.findFirstOrThrow({ where: { active: true } });
  assert.equal(p2.version, p1.version + 1);
  assert.equal(await db.signingPolicy.count({ where: { active: true } }), 1);

  await setRuleEnabled(saved.id!, false, "owner");
  assert.equal(policyRules.parse((await db.signingPolicy.findFirstOrThrow({ where: { active: true } })).rules).customers.length, 0);
  await setRuleEnabled(saved.id!, true, "owner");
  const second = await saveRule({ ...baseRule, customerName: "Acme", maxAmount: 5000, paymentTerms: ["60 days"], cc: [] }, "owner");
  assert.equal(policyRules.parse((await db.signingPolicy.findFirstOrThrow({ where: { active: true } })).rules).customers.length, 2, "several rules per customer");
  await deleteRule(second.id!, "owner");
});

test("automatic signing cannot be switched on until setup is genuinely complete", async () => {
  const { setAutomaticSigning, NotReady } = await import("./rules");
  const { readiness } = await import("./readiness");
  await db.signatureImage.updateMany({ data: { active: false } });
  const r0 = await readiness();
  assert.equal(r0.complete, false);
  assert.ok(r0.missing.some((m) => /signature/.test(m)));
  await assert.rejects(setAutomaticSigning(true, "owner"), NotReady);
  assert.equal((await db.signingPolicy.findFirstOrThrow({ where: { active: true } })).autonomousSigningEnabled, false);

  await db.signatureImage.create({ data: { version: 99, driveId: "d", itemId: "i", fileName: "x", sha256: "h", sizeBytes: 1, width: 400, height: 120, active: true } });
  await assert.rejects(setAutomaticSigning(true, "owner"), /digital signature/);
  await db.signatureProfile.create({ data: { signatoryName: "O", title: "", certificateRef: "d:c", certificateFingerprint: "f", certSubject: "CN=O", certNotAfter: new Date(Date.now() + 1e10), active: true, runtimeApprovedAt: new Date() } });
  await setAutomaticSigning(true, "owner");
  assert.equal((await db.signingPolicy.findFirstOrThrow({ where: { active: true } })).autonomousSigningEnabled, true);
  await setAutomaticSigning(false, "owner");
  assert.equal((await db.signingPolicy.findFirstOrThrow({ where: { active: true } })).autonomousSigningEnabled, false);
});

test("rule form validation gives plain-language messages", async () => {
  const { ruleFormSchema, ruleSentence } = await import("./rule-schema");
  const bad = ruleFormSchema.safeParse({ ...baseRule, customerName: "", maxAmount: -5, cc: ["not-an-email"] });
  assert.equal(bad.success, false);
  const msgs = bad.error!.issues.map((i) => i.message).join(" | ");
  assert.match(msgs, /Choose a customer/);
  assert.match(msgs, /more than 0/);
  assert.match(msgs, /email address/);
  assert.equal(ruleFormSchema.safeParse({ ...baseRule, cc: ["LENA@GFS.TEST"] }).data?.cc[0], "lena@gfs.test");
  assert.match(ruleSentence(baseRule), /^When a sales contract arrives from Acme for up to 50,000 EUR.*sign it and copy 1 person\./);
});

// ---- AI assist --------------------------------------------------------------------------------------------
test("AI help proposes values but never saves a rule or approves a recipient", async () => {
  const { proposeRule } = await import("./rule-assist");
  const before_ = await db.signingRule.count();
  const r = await proposeRule("Always CC Lena Commercial when signing sales contracts up to 30k EUR with 60 days payment");
  assert.equal(r.proposal.maxAmount, 30000);
  assert.equal(r.proposal.currency, "EUR");
  assert.deepEqual(r.proposal.paymentTerms, ["60 days"]);
  assert.ok(r.people.length >= 1 && r.people[0].matches.some((m) => m.email === "lena@gfs.test"), "names are matched against the owner's own contacts");
  assert.ok(!("cc" in r.proposal), "no recipient is pre-approved");
  assert.equal(await db.signingRule.count(), before_, "nothing was saved");
});

// ---- connection status ---------------------------------------------------------------------------------------
test("connection status reflects what Microsoft granted, never an assumption", async () => {
  const { connectionStatus } = await import("./connection");
  const { storeRefreshToken } = await import("./graph-token");

  scopes = "Mail.Read Mail.ReadWrite Contacts.Read";
  await storeRefreshToken("owner-oid", "rt4");
  const noFiles = await connectionStatus();
  assert.equal(noFiles.oneDrive.state, "attention");
  assert.match(noFiles.oneDrive.message, /OneDrive access wasn't allowed/);
  assert.equal(noFiles.overall, "attention");

  scopes = "Mail.Read Mail.ReadWrite Files.ReadWrite";
  await storeRefreshToken("owner-oid", "rt5");
  const unpublished = await connectionStatus();
  assert.equal(unpublished.outlook.state, "attention");
  assert.match(unpublished.outlook.message, /published online/);
  assert.equal(unpublished.contacts.state, "attention");
  assert.equal(unpublished.oneDrive.state, "connected");

  const mb = await db.mailboxConnection.findFirstOrThrow();
  await db.graphSubscription.create({ data: { graphId: "g1", mailboxId: mb.id, resource: "r", clientState: "c", expiresAt: new Date(Date.now() + 1e9), status: "active" } });
  const live = await connectionStatus();
  assert.equal(live.outlook.state, "connected");
  assert.equal(live.account?.email, OWNER);
  assert.equal(live.lastEmailAt, null, "no email has arrived, so none is claimed");
});

test("without a stored sign-in the status is disconnected", async () => {
  const { connectionStatus } = await import("./connection");
  await db.oAuthConnection.deleteMany();
  const s = await connectionStatus();
  assert.equal(s.overall, "disconnected");
  assert.equal(s.account, null);
});

test("ensureSubscription refuses unpublished (non-HTTPS) apps instead of failing in Graph", async () => {
  const { ensureSubscription } = await import("./subscriptions");
  assert.equal(await ensureSubscription(), "not-public");
});

test("spending summary reports business figures", async () => {
  const { spendingSummary, setSpendingLimit, setAiEnabled } = await import("./spending");
  await setSpendingLimit(10);
  const mb = await db.mailboxConnection.findFirstOrThrow();
  const c = await db.contract.create({ data: { mailboxId: mb.id, graphMessageId: "sp", attachmentId: "a", attachmentName: "x.pdf", contentHash: "sp" } });
  await db.contractAnalysis.create({ data: { contractId: c.id, model: "m", result: {}, decision: "APPROVE", reasons: [], costUsd: 1 } });
  await db.usageRecord.create({ data: { source: "openai", contractId: c.id, model: "m", costUsd: 2.5, inputTokens: 10, outputTokens: 5 } });
  const s = await spendingSummary();
  assert.equal(s.spent, 2.5);
  assert.equal(s.limit, 10);
  assert.equal(s.percent, 25);
  assert.equal(s.contractsAnalysed, 1);
  assert.equal(s.averagePerContract, 2.5);
  assert.equal(s.enabled, true);
  await setAiEnabled(false);
  assert.equal((await spendingSummary()).enabled, false);
});
