import { contractExtraction } from "./contract-schema";
import { getDb } from "./db";
import { requireEnv } from "./env";
import { isPdf } from "./limits";
import { audit, setStage } from "./pipeline";
import { SigningRefused, signPdf, verifyPdfSignature } from "./pdf-sign";
import { open } from "./secret-box";
import { downloadFile, storageRoot, uploadFile } from "./sharepoint";

const parseRef = (ref: string) => {
  const [driveId, itemId] = ref.split(":");
  return { driveId, itemId };
};

// `next` queues the storage stage; it is called only when a verified signed document exists.
export async function signContract(contractId: string, next: () => Promise<unknown>) {
  const db = getDb();
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { documents: true } });

  // A signed document already exists: never sign the same version twice.
  if (c.documents.some((d) => d.kind === "SIGNED")) {
    await next();
    return { skipped: "already signed" };
  }

  // Authorization is re-checked here, independent of the upstream task.
  const analysis = await db.contractAnalysis.findFirstOrThrow({ where: { contractId }, orderBy: { createdAt: "desc" } });
  const policy = await db.signingPolicy.findFirst({ where: { active: true }, orderBy: { version: "desc" } });
  const profile = await db.signatureProfile.findFirst({ where: { active: true } });
  if (
    analysis.decision !== "APPROVE" ||
    !policy?.autonomousSigningEnabled ||
    analysis.policyVersion !== policy.version ||
    !profile?.runtimeApprovedAt ||
    profile.certNotAfter <= new Date()
  ) {
    await setStage(contractId, "REQUIRES_REVIEW", { status: "NEEDS_REVIEW", exception: "Authorization no longer valid at signing time" });
    return { signed: false };
  }
  const extracted = contractExtraction.parse(analysis.result);
  const location = extracted.gfsSignatureLocations[0];

  await setStage(contractId, "SIGNING", { status: "SIGNING" });
  const original = c.documents.find((d) => d.kind === "ORIGINAL");
  if (!original) throw new Error("original missing");

  const pdf = await downloadFile(original, original.sha256);
  if (!isPdf(pdf)) throw new Error("original is not a PDF");
  const p12 = open(await downloadFile(parseRef(profile.certificateRef)));
  const png = await downloadFile(parseRef(profile.signatureImageRef));

  let signed: Buffer;
  try {
    signed = await signPdf({
      pdf, p12, passphrase: requireEnv("SIGNING_P12_PASSWORD"), signaturePng: png, location,
      signerName: profile.signatoryName, reason: `Sales contract ${c.contractNumber ?? ""}`.trim(),
    });
  } catch (e) {
    if (e instanceof SigningRefused) {
      // Cannot be signed safely (existing signatures, encryption, bad box): escalate, never retry.
      await setStage(contractId, "REQUIRES_REVIEW", { status: "NEEDS_REVIEW", exception: `Signing stopped: ${e.message}` });
      return { signed: false, reason: e.message };
    }
    throw e;
  }

  await setStage(contractId, "VERIFYING", { status: "SIGNING" });
  const check = verifyPdfSignature(signed);
  if (!check.intact || !check.valid || check.certExpired) {
    await setStage(contractId, "REQUIRES_REVIEW", { status: "NEEDS_REVIEW", exception: "Signature failed independent verification" });
    return { signed: false, reason: "verification failed" };
  }
  const verification = {
    signatures: [{ field: "GFS", ours: true, intact: check.intact, valid: check.valid }],
    certSubject: check.certSubject, certSha256: check.certSha256, selfSigned: check.selfSigned,
    selfSignedNotice: check.selfSigned ? "Cryptographically valid; identity is not backed by a trusted CA." : undefined,
    verifiedAt: new Date().toISOString(),
  };

  const stored = await uploadFile(`${storageRoot()}/Signed/${contractId}`, `signed-${c.attachmentName}`, signed);
  await db.documentRef.upsert({
    where: { contractId_kind: { contractId, kind: "SIGNED" } },
    create: { contractId, kind: "SIGNED", driveId: stored.driveId, itemId: stored.itemId, sha256: stored.sha256, verification, policyVersion: policy.version },
    // A retry after upload but before this write re-signs; the ref must follow the file now at that path.
    update: { driveId: stored.driveId, itemId: stored.itemId, sha256: stored.sha256, verification, policyVersion: policy.version },
  });
  await db.contract.update({ where: { id: contractId }, data: { status: "SIGNED" } });
  await audit(contractId, "signed", { policyVersion: policy.version, certSha256: check.certSha256 });
  await next();
  return { signed: true };
}
