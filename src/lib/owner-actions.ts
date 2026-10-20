import { tasks } from "@trigger.dev/sdk";
import { getDb } from "./db";
import { createReplyDraft } from "./drafts";
import { audit, failureReason, markFailed, setStatus } from "./pipeline";
import { parsePlacement, placementSchema, type Placement } from "./placement";
import { processDocument } from "./processing";
import { rememberPlacement } from "./sender-rules";
import { signDocument } from "./signing";
import type { processDocumentTask } from "@/trigger/process-document";

// What the owner can do on one document. Each call says in one sentence what happened.
export type Outcome = { ok: boolean; message: string };

const SIGNABLE = ["NEEDS_ATTENTION", "SKIPPED", "FAILED"];

// The owner places or confirms the signature. That confirmation is the authorization for this one document.
export async function approveAndSign(contractId: string, raw: Placement, opts: { remember: boolean; actor: string }): Promise<Outcome> {
  const placement = placementSchema.parse(raw);
  const db = getDb();
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { documents: { select: { kind: true } } } });
  if (c.pageCount && placement.page > c.pageCount) return { ok: false, message: "That page isn't in this document." };
  if (c.documents.some((d) => d.kind === "SIGNED")) return saveDraft(contractId, opts.actor);

  // Claim the document so two clicks, or a background run, can't sign it twice.
  const claimed = await db.contract.updateMany({ where: { id: contractId, status: { in: SIGNABLE } }, data: { status: "SIGNING", attention: null, exception: null, placement } });
  if (claimed.count === 0) return { ok: false, message: "This document is already being processed. Refresh to see its status." };
  await audit(contractId, "owner:approved", { placement }, opts.actor);

  try {
    const r = await signDocument(contractId, { by: "owner", actor: opts.actor }, placement);
    if (!r.signed) {
      const now = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
      return { ok: false, message: now.exception ?? "The signature couldn't be added." };
    }
  } catch (e) {
    await markFailed(contractId, e);
    return { ok: false, message: failureReason(e) };
  }
  if (opts.remember && c.senderAddress && c.pageCount) await rememberPlacement(c.senderAddress, { ...placement, pageCount: c.pageCount }, opts.actor);
  return saveDraft(contractId, opts.actor, "Signed. ");
}

// Bulk path: the owner confirms the position the app already suggested. Anything that needs a human look
// (injection warning, missing setup, unsure position, an identical file already signed) is refused here too,
// so a crafted selection can't sign what the list wouldn't offer.
export async function approveSuggested(contractId: string, actor: string): Promise<Outcome> {
  const db = getDb();
  const c = await db.contract.findUnique({ where: { id: contractId } });
  if (!c) return { ok: false, message: "This document no longer exists." };
  const placement = parsePlacement(c.placement);
  if (c.status !== "NEEDS_ATTENTION" || c.attention !== "APPROVAL" || !placement) return { ok: false, message: "This one needs a closer look. Open it to continue." };
  const twin = await db.contract.count({ where: { id: { not: c.id }, contentHash: c.contentHash, documents: { some: { kind: "SIGNED" } } } });
  if (twin > 0) return { ok: false, message: "An identical file was already signed. Open it to confirm." };
  return approveAndSign(contractId, placement, { remember: false, actor });
}

export async function saveDraft(contractId: string, actor: string, prefix = ""): Promise<Outcome> {
  try {
    await createReplyDraft(contractId);
    await audit(contractId, "owner:draft", undefined, actor);
    return { ok: true, message: `${prefix}The draft is saved in Outlook. Review it there and send it when you're ready.` };
  } catch (e) {
    await markFailed(contractId, e);
    return { ok: false, message: `${prefix}${failureReason(e)}` };
  }
}

// Starts the run again from where it stopped. Reading can take a while, so it goes to the background when possible.
export async function retry(contractId: string, actor: string): Promise<Outcome> {
  const db = getDb();
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { documents: { select: { kind: true } } } });
  if (c.documents.some((d) => d.kind === "SIGNED")) return saveDraft(contractId, actor);
  if (c.status !== "FAILED") return { ok: false, message: "Only a failed document can be retried." };
  await setStatus(contractId, "RECEIVED");
  await audit(contractId, "owner:retry", undefined, actor);
  try {
    await tasks.trigger<typeof processDocumentTask>("process-document", { contractId }, { idempotencyKey: `process:${contractId}:retry:${Date.now()}`, tags: ["gfs", `contract_${contractId}`] });
    return { ok: true, message: "Processing again. This page updates by itself." };
  } catch {
    // Background processing isn't reachable (for example during local development): run it here.
    try {
      await processDocument(contractId, () => createReplyDraft(contractId));
      return { ok: true, message: "Processed again." };
    } catch (e) {
      await markFailed(contractId, e);
      return { ok: false, message: failureReason(e) };
    }
  }
}

export async function skip(contractId: string, actor: string): Promise<Outcome> {
  const r = await getDb().contract.updateMany({
    where: { id: contractId, status: { in: ["NEEDS_ATTENTION", "FAILED"] }, documents: { none: { kind: "SIGNED" } } },
    data: { status: "SKIPPED", attention: null, exception: "Skipped by you." },
  });
  if (r.count === 0) return { ok: false, message: "This document can't be skipped now." };
  await audit(contractId, "owner:skipped", undefined, actor);
  return { ok: true, message: "Skipped. It stays in the inbox under All." };
}
