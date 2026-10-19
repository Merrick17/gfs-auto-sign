import { getDb } from "./db";
import type { CertificateInfo } from "./certificate";
import { APP_FOLDER } from "./signature-image";
import { seal } from "./secret-box";
import { uploadFile } from "./sharepoint";

// Stores the sealed certificate in the owner's private OneDrive folder and activates it.
// `consent` is the owner's explicit authorisation for the automated service to use it.
export async function saveSigner(input: { name: string; title: string; p12: Buffer; info: CertificateInfo; consent: boolean }) {
  if (!input.consent) throw new Error("Consent is required before the certificate can be used automatically.");
  const stored = await uploadFile(`${APP_FOLDER}/Digital signature`, `certificate-${input.info.fingerprint.slice(0, 12)}.enc`, seal(input.p12), "application/octet-stream");
  const db = getDb();
  await db.signatureProfile.updateMany({ where: { active: true }, data: { active: false } });
  const row = await db.signatureProfile.create({
    data: {
      signatoryName: input.name,
      title: input.title,
      certificateRef: `${stored.driveId}:${stored.itemId}`,
      certificateFingerprint: input.info.fingerprint,
      certSubject: input.info.subject,
      certNotAfter: input.info.notAfter,
      selfSigned: input.info.selfSigned,
      active: true,
      runtimeApprovedAt: new Date(),
    },
  });
  await db.auditEvent.create({ data: { actor: "owner", action: "signer:set-up", data: { fingerprint: input.info.fingerprint, selfSigned: input.info.selfSigned } } });
  return row;
}
