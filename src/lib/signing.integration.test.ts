import { migrationSql, seedOAuth } from "./test-db";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import forge from "node-forge";
import { PDFDocument } from "pdf-lib";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@/generated/prisma/client";
import { signPdf, verifyPdfSignature } from "./pdf-sign";
import { p12Password } from "./certificate";
import { seal } from "./secret-box";
import { sha256 } from "./sharepoint";

process.env.AZURE_TENANT_ID = "t";
process.env.AZURE_CLIENT_ID = "c";
process.env.AZURE_CLIENT_SECRET = "s";
process.env.SHAREPOINT_DRIVE_ID = "drive1";
process.env.CERT_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const location = { page: 1, x: 0.1, y: 0.8, width: 0.3, height: 0.08, evidence: "sign here" };
const FULL = {
  isSalesContract: true, customer: "Acme GmbH", contractNumber: "SC", version: "1", contractDate: null, currency: "EUR", amount: 1, contractType: null,
  language: "en", articles: [], paymentTerms: null, deliveryTerms: null, obligations: [], unusualCommitments: [], existingSignatures: [],
  gfsSignatureLocations: [location], inconsistencies: [], missingFields: [], historyDeviations: [], promptInjectionSuspected: false, confidence: 0.9, evidence: [],
};

function makeP12(password: string, years = 1) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86400_000);
  cert.validity.notAfter = new Date(Date.now() + years * 365 * 86400_000);
  const a = [{ name: "commonName", value: "Owner" }];
  cert.setSubject(a);
  cert.setIssuer(a);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: "3des" })).getBytes(), "binary");
}
const blank = async () => {
  const d = await PDFDocument.create();
  d.addPage([595, 842]).drawText("Sales contract");
  return Buffer.from(await d.save());
};

let pg: PGlite;
let db: PrismaClient;
let signContract: typeof import("./signing").signContract;
const files = new Map<string, Buffer>();
let uploads = 0;
let nextCalls = 0;
const next = async () => void nextCalls++;
let p12: Buffer;
let mailboxId: string;
let n = 0;

const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });

before(async () => {
  pg = new PGlite();
  await pg.exec(migrationSql());
  db = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  await seedOAuth(db);

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(input instanceof Request ? input.url : input));
    if (url.includes("oauth2/v2.0/token")) return json({ access_token: "t", expires_in: 3600 });
    if (init?.method === "PUT" && url.includes("/root:/")) {
      const id = `f${files.size + 1}`;
      files.set(id, Buffer.from(init.body as Uint8Array));
      uploads++;
      return json({ id, size: 1 });
    }
    const m = /items\/([^/]+)\/content/.exec(url);
    if (m && files.has(m[1])) return new Response(new Uint8Array(files.get(m[1])!));
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  p12 = makeP12(p12Password());
  const put = (b: Buffer) => {
    const id = `f${files.size + 1}`;
    files.set(id, b);
    return `drive1:${id}`;
  };
  const imgRef = put(PNG).split(":")[1];
  await db.signatureImage.create({ data: { version: 1, driveId: "drive1", itemId: imgRef, fileName: "s.png", sha256: sha256(PNG), sizeBytes: PNG.length, width: 1, height: 1, active: true } });
  await db.signatureProfile.create({
    data: {
      signatoryName: "Owner", title: "CEO", certificateRef: put(seal(p12)),
      certificateFingerprint: "fp", certSubject: "CN=Owner", certNotAfter: new Date(Date.now() + 1e10), active: true, runtimeApprovedAt: new Date(),
    },
  });
  await db.signingPolicy.create({ data: { version: 1, active: true, autonomousSigningEnabled: true, rules: {}, createdBy: "t" } });
  mailboxId = (await db.mailboxConnection.create({ data: { mailboxId: "o@gfs.test", tenantId: "t" } })).id;
  ({ signContract } = await import("./signing"));
});

after(async () => {
  await db.$disconnect();
  await pg.close();
});

async function seed(opts: { original?: Buffer; decision?: string; policyVersion?: number } = {}) {
  n++;
  const original = opts.original ?? (await blank());
  const c = await db.contract.create({
    data: { mailboxId, graphMessageId: `m${n}`, attachmentId: "a", attachmentName: "SC.pdf", contentHash: sha256(original), customer: "Acme GmbH", contractNumber: `SC-${n}`, status: "AUTHORIZED" },
  });
  const id = `f${files.size + 1}`;
  files.set(id, original);
  await db.documentRef.create({ data: { contractId: c.id, kind: "ORIGINAL", driveId: "drive1", itemId: id, sha256: sha256(original) } });
  await db.contractAnalysis.create({
    data: { contractId: c.id, model: "m", result: FULL, decision: opts.decision ?? "APPROVE", reasons: [], policyVersion: opts.policyVersion ?? 1 },
  });
  return c.id;
}
const signedRef = (id: string) => db.documentRef.findUnique({ where: { contractId_kind: { contractId: id, kind: "SIGNED" } } });

test("authorized contract is signed, verified, stored and handed on", async () => {
  const id = await seed();
  const before_ = nextCalls;
  const r = await signContract(id, next);
  assert.deepEqual(r, { signed: true });
  const ref = await signedRef(id);
  assert.ok(ref);
  const bytes = files.get(ref.itemId)!;
  assert.equal(sha256(bytes), ref.sha256);
  const v = verifyPdfSignature(bytes);
  assert.ok(v.intact && v.valid);
  assert.equal(nextCalls, before_ + 1);
  assert.equal((await db.contract.findUniqueOrThrow({ where: { id } })).status, "SIGNED");
});

test("a retry never signs the same document twice", async () => {
  const id = await seed();
  await signContract(id, next);
  const u = uploads;
  const r = await signContract(id, next);
  assert.deepEqual(r, { skipped: "already signed" });
  assert.equal(uploads, u);
});

test("disabled mandate at signing time leaves the contract unsigned", async () => {
  const id = await seed();
  await db.signingPolicy.updateMany({ data: { autonomousSigningEnabled: false } });
  const r = (await signContract(id, next)) as { signed: boolean };
  await db.signingPolicy.updateMany({ data: { autonomousSigningEnabled: true } });
  assert.equal(r.signed, false);
  assert.equal(await signedRef(id), null);
  assert.equal((await db.contract.findUniqueOrThrow({ where: { id } })).status, "NEEDS_REVIEW");
});

test("a review decision or stale policy version is never signed", async () => {
  const a = await seed({ decision: "REVIEW" });
  const b = await seed({ policyVersion: 99 });
  for (const id of [a, b]) {
    assert.equal(((await signContract(id, next)) as { signed: boolean }).signed, false);
    assert.equal(await signedRef(id), null);
  }
});

test("an expired or unapproved certificate is never used", async () => {
  const id = await seed();
  await db.signatureProfile.updateMany({ data: { runtimeApprovedAt: null } });
  assert.equal(((await signContract(id, next)) as { signed: boolean }).signed, false);
  await db.signatureProfile.updateMany({ data: { runtimeApprovedAt: new Date() } });
  assert.equal(await signedRef(id), null);
});

test("a document that already carries a digital signature is escalated unsigned", async () => {
  const pre = await signPdf({ pdf: await blank(), p12: makeP12("x"), passphrase: "x", signaturePng: PNG, location, signerName: "Customer", reason: "r" });
  const id = await seed({ original: pre });
  const r = (await signContract(id, next)) as { signed: boolean; reason?: string };
  assert.equal(r.signed, false);
  assert.match(r.reason ?? "", /already carries digital signatures/);
  assert.equal(await signedRef(id), null);
  assert.equal((await db.contract.findUniqueOrThrow({ where: { id } })).status, "NEEDS_REVIEW");
});
