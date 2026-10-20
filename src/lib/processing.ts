import { aiAvailable, readDocument } from "./analysis";
import { readExtraction } from "./contract-schema";
import { getDb } from "./db";
import { locateSignature } from "./locate-signature";
import { decide } from "./decide";
import { audit, needsAttention, setStatus } from "./pipeline";
import { pageCount, unsignableReason } from "./pdf-sign";
import { parseRemembered } from "./placement";
import { ruleFor } from "./sender-rules";
import { getSigningSettings } from "./settings";
import { getActiveSignatureImage } from "./signature-image";
import { signDocument } from "./signing";
import { downloadFile } from "./sharepoint";

// The layout reader never throws: a PDF it can't parse simply gets no suggestion. Its result is kept like an analysis.
async function readLayout(contractId: string, pdf: Buffer) {
  try {
    const r = await locateSignature(pdf);
    if (r.locations.length === 0) return null;
    await getDb().contractAnalysis.create({
      data: { contractId, model: "layout", decision: "READ", reasons: [], result: { needsSignature: true, signatureLocations: r.locations, promptInjectionSuspected: false, confidence: r.confidence, role: r.role } },
    });
    return r;
  } catch {
    return null;
  }
}

// Step 2 (document ingested) and, when the owner's settings allow it, step 3 (signature added).
// `enqueueDraft` queues step 4 once a signed copy exists. Safe to run again at any point.
export async function processDocument(contractId: string, enqueueDraft: () => Promise<unknown>) {
  const db = getDb();
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { documents: true } });
  if (c.documents.some((d) => d.kind === "SIGNED")) {
    await enqueueDraft();
    return { next: "draft" };
  }
  if (!["RECEIVED", "FAILED"].includes(c.status)) return { skipped: c.status };
  await setStatus(contractId, "RECEIVED");

  const original = c.documents.find((d) => d.kind === "ORIGINAL");
  if (!original) throw new Error("original missing");
  const pdf = await downloadFile(original, original.sha256);
  const blocked = unsignableReason(pdf);
  const pages = await pageCount(pdf);
  await db.contract.update({ where: { id: contractId }, data: { pageCount: pages } });

  // Reading is a help, not a requirement: without it the owner places the signature.
  // The AI reads first; the document's own layout is the fallback when the AI is unavailable, out of credits,
  // failing, or finds no position. A position anchored on a labelled GFS signature block wins.
  let extraction = readExtraction((await db.contractAnalysis.findFirst({ where: { contractId }, orderBy: { createdAt: "desc" } }))?.result);
  let readFailed = false;
  let source: "ai" | "layout" | null = extraction ? "ai" : null;
  if (!extraction && !blocked && aiAvailable()) {
    try {
      extraction = readExtraction(await readDocument(contractId, pdf, c.attachmentName));
      source = "ai";
    } catch (e) {
      readFailed = true;
      // Status code only: the message can echo document content.
      await audit(contractId, "read:failed", { status: (e as { status?: number }).status ?? null });
    }
  }
  if (!blocked && !extraction?.suspicious) {
    const layout = await readLayout(contractId, pdf);
    if (layout && (!extraction || extraction.locations.length === 0 || layout.confidence >= 0.9)) {
      extraction = { needsSignature: true, locations: layout.locations, suspicious: false, confidence: layout.confidence };
      source = "layout";
      readFailed = false;
    }
  }
  await audit(contractId, "ingested", { pages, read: Boolean(extraction), source });

  const [rule, settings, image, duplicate] = await Promise.all([
    ruleFor(c.senderAddress),
    getSigningSettings(),
    getActiveSignatureImage(),
    db.contract.count({ where: { id: { not: contractId }, contentHash: c.contentHash, documents: { some: { kind: "SIGNED" } } } }),
  ]);
  const d = decide({
    extraction,
    pageCount: pages,
    remembered: parseRemembered(rule?.placement),
    autoSignAuthorized: settings.autoSign,
    senderAutoSign: Boolean(rule?.autoSign),
    hasSignatureImage: Boolean(image),
    duplicateSigned: duplicate > 0,
    unsignableReason: blocked,
  });

  if (d.kind === "skip") {
    await setStatus(contractId, "SKIPPED", { exception: d.reason });
    await audit(contractId, "skipped", { reason: d.reason });
    return { skipped: true };
  }
  if (d.kind === "attention") {
    if (d.suggestion) await db.contract.update({ where: { id: contractId }, data: { placement: d.suggestion } });
    const reason = readFailed && d.attention === "PLACEMENT" ? "The document couldn't be read automatically. Choose where your signature goes." : d.reason;
    await needsAttention(contractId, d.attention, reason);
    return { attention: d.attention };
  }
  const r = await signDocument(contractId, { by: "auto" }, d.placement);
  if (r.signed) await enqueueDraft();
  return { signed: r.signed, source: d.source };
}
