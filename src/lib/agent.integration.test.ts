import { migrationSql } from "./test-db";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@/generated/prisma/client";

let pg: PGlite;
let db: PrismaClient;

before(async () => {
  pg = new PGlite();
  await pg.exec(migrationSql());
  db = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
});

after(async () => {
  await db.$disconnect();
  await pg.close();
});

// A two-page contract laid out like the real ones: GFS named as vendor on page 1, two signature blocks at the end.
async function contract(opts: { vendor?: string; rotate?: number } = {}) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p1 = d.addPage([612, 792]);
  p1.drawText("Sales Contract", { x: 250, y: 740, size: 14, font: f });
  p1.drawText("Vendor:", { x: 70, y: 690, size: 10, font: f });
  p1.drawText(opts.vendor ?? "5006306 - Green Fashion Solution FZCO", { x: 170, y: 690, size: 10, font: f });
  p1.drawText("Principal:", { x: 70, y: 670, size: 10, font: f });
  p1.drawText("s.Oliver Bernd Freier GmbH", { x: 170, y: 670, size: 10, font: f });
  const p2 = d.addPage([612, 792]);
  p2.drawText("This contract is valid without a signature on our part.", { x: 73, y: 317, size: 9, font: f });
  p2.drawText("Date/stamp/signature", { x: 73, y: 238, size: 9, font: f });
  p2.drawText("vendor", { x: 73, y: 228, size: 9, font: f });
  p2.drawText("Date/stamp/signature", { x: 460, y: 238, size: 9, font: f });
  p2.drawText("principal", { x: 460, y: 228, size: 9, font: f });
  if (opts.rotate) p2.setRotation(degrees(opts.rotate));
  return Buffer.from(await d.save());
}

test("the layout reader finds the GFS (vendor) block on the last page, in free space above its label", async () => {
  const { locateSignature } = await import("./locate-signature");
  const r = await locateSignature(await contract());
  assert.equal(r.role, "vendor");
  assert.ok(r.confidence >= 0.9);
  const l = r.locations[0];
  assert.equal(l.page, 2);
  assert.ok(l.x < 0.2, "left block, not the principal's");
  const label = 1 - 238 / 792;
  const line = 1 - 317 / 792;
  assert.ok(l.y + l.height < label - 0.01, "above the label");
  assert.ok(l.y > line, "below the printed sentence");
});

test("without GFS named in the document, two signature blocks are not guessed between", async () => {
  const { locateSignature } = await import("./locate-signature");
  const r = await locateSignature(await contract({ vendor: "Someone Else Ltd" }));
  assert.equal(r.locations.length, 0);
});

test("the layout fallback lets the agent sign without the AI, and only with the owner's authorization", async () => {
  const { decide } = await import("./decide");
  const { locateSignature } = await import("./locate-signature");
  const r = await locateSignature(await contract());
  const base = { extraction: { needsSignature: true, locations: r.locations, suspicious: false, confidence: r.confidence }, pageCount: 2, remembered: null, hasSignatureImage: true, duplicateSigned: false, unsignableReason: null };
  assert.equal(decide({ ...base, autoSignAuthorized: true, senderAutoSign: true }).kind, "sign");
  const off = decide({ ...base, autoSignAuthorized: false, senderAutoSign: true });
  assert.equal(off.kind, "attention");
  assert.deepEqual(off.kind === "attention" && off.suggestion, r.locations[0], "the position is still suggested");
});

test("the email body falls back to the owner's message, or a greeting by first name, when no AI answers", async () => {
  delete process.env.OPENAI_API_KEY;
  const { prepareBody } = await import("./drafts");
  assert.deepEqual(await prepareBody({ senderName: "Geworg GFS", subject: "WG: Sales Contract", attachmentName: "SC-1.pdf" }, ""), {
    text: "Dear Geworg,\n\nPlease find attached the signed SC-1.\n\nKind regards",
    by: "template",
  });
  assert.equal((await prepareBody({ senderName: "<script>", subject: null, attachmentName: "x.pdf" }, "")).text.startsWith("Hello,"), true);
  assert.equal((await prepareBody({ senderName: "A", subject: null, attachmentName: "x.pdf" }, "Hi team")).text, "Hi team");
});

test("failed documents are retried automatically with growing waits, at most three times, never for sign-in failures", async () => {
  const { retryFailedDocuments, MAX_AUTO_RETRIES } = await import("./auto-retry");
  const old = new Date(Date.now() - 3600_000);
  const mk = async (n: string, error: string, signed = false) => {
    const c = await db.contract.create({ data: { mailboxId: "m", graphMessageId: n, attachmentId: "a", attachmentName: `${n}.pdf`, contentHash: n, status: "FAILED" } });
    await db.auditEvent.create({ data: { contractId: c.id, actor: "system", action: "failed", data: { error } } });
    if (signed) await db.documentRef.create({ data: { contractId: c.id, kind: "SIGNED", driveId: "d", itemId: "i", sha256: "s" } });
    await pg.query(`UPDATE "Contract" SET "updatedAt" = $1 WHERE id = $2`, [old.toISOString(), c.id]);
    return c.id;
  };
  const transient = await mk("t1", "GraphError");
  const signed = await mk("t2", "GraphError", true);
  const signIn = await mk("t3", "AuthRequired");
  const calls: string[] = [];
  const start = async (id: string, kind: string, attempt: number) => void calls.push(`${id}:${kind}:${attempt}`);

  await retryFailedDocuments(start);
  assert.deepEqual(calls.sort(), [`${signed}:draft:1`, `${transient}:process:1`].sort());
  assert.equal((await db.contract.findUniqueOrThrow({ where: { id: signed } })).status, "SIGNED");
  assert.equal((await db.contract.findUniqueOrThrow({ where: { id: signIn } })).status, "FAILED");

  // Fails again immediately: the next attempt waits longer than the first.
  await db.contract.update({ where: { id: transient }, data: { status: "FAILED" } });
  calls.length = 0;
  await retryFailedDocuments(start);
  assert.equal(calls.length, 0, "too soon");
  await retryFailedDocuments(start, Date.now() + 11 * 60_000);
  assert.deepEqual(calls, [`${transient}:process:2`]);

  for (let i = 3; i <= MAX_AUTO_RETRIES + 1; i++) {
    await db.contract.update({ where: { id: transient }, data: { status: "FAILED" } });
    await retryFailedDocuments(start, Date.now() + 24 * 3600_000);
  }
  assert.equal(await db.auditEvent.count({ where: { contractId: transient, action: "auto-retry" } }), MAX_AUTO_RETRIES);
});
