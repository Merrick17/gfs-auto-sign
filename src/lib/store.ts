import { getDb } from "./db";
import { audit, setStage } from "./pipeline";
import { downloadFile } from "./sharepoint";

// The signing task already wrote the signed PDF to SharePoint. This stage re-reads it, confirms the
// stored bytes match the recorded hash and verification outcome, and only then releases it to drafting.
// Re-reads the signed file, checks hash and verification record, then releases it to drafting via `next`.
export async function storeSigned(contractId: string, next: () => Promise<unknown>) {
  const db = getDb();
  const signed = await db.documentRef.findUniqueOrThrow({ where: { contractId_kind: { contractId, kind: "SIGNED" } } });
  await setStage(contractId, "UPLOADING");
  await downloadFile(signed, signed.sha256); // throws on hash mismatch
  const v = signed.verification as { signatures?: { ours: boolean; intact: boolean; valid: boolean }[] } | null;
  const ours = v?.signatures?.find((s) => s.ours);
  if (!ours?.intact || !ours.valid) {
    await setStage(contractId, "REQUIRES_REVIEW", { status: "NEEDS_REVIEW", exception: "Signed document has no passing verification record" });
    return { stored: false };
  }
  await db.contract.update({ where: { id: contractId }, data: { status: "STORED", signedDocId: signed.id } });
  await audit(contractId, "stored", { sha256: signed.sha256, policyVersion: signed.policyVersion });
  await next();
  return { stored: true };
}
