import { getDb } from "./db";
import { isPdf } from "./limits";
import { audit, needsAttention, setStatus } from "./pipeline";
import { parsePlacement, type Placement } from "./placement";
import { SigningRefused, stampSignature } from "./pdf-sign";
import { ruleFor } from "./sender-rules";
import { getSigningSettings } from "./settings";
import { getActiveSignatureImage, readSignatureImage } from "./signature-image";
import { downloadFile, storageRoot, uploadFile } from "./sharepoint";

// Who allowed this signature: the owner's standing authorization for this sender, or the owner just now.
export type SignAuthority = { by: "auto" } | { by: "owner"; actor: string };

export class NotAllowed extends Error {}

// Adds the signature image and stores the signed copy next to the original. Idempotent: a document is signed once.
// Authorization is checked here again, independent of whoever asked for the signature.
export async function signDocument(contractId: string, authority: SignAuthority, placementInput?: Placement) {
  const db = getDb();
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { documents: true } });
  if (c.documents.some((d) => d.kind === "SIGNED")) return { signed: true, already: true };

  const placement = parsePlacement(placementInput ?? c.placement);
  if (!placement) throw new NotAllowed("No signature position");
  const image = await getActiveSignatureImage();
  if (!image) {
    await needsAttention(contractId, "SETUP", "Add your signature image in Settings to sign this document.");
    return { signed: false };
  }
  if (authority.by === "auto") {
    const [settings, rule] = await Promise.all([getSigningSettings(), ruleFor(c.senderAddress)]);
    if (!settings.autoSign || !rule?.autoSign) {
      await needsAttention(contractId, "APPROVAL", "Automatic signing was turned off before this document was signed. Check and approve.");
      return { signed: false };
    }
  }

  await db.contract.update({ where: { id: contractId }, data: { status: "SIGNING", attention: null, exception: null, placement } });
  const original = c.documents.find((d) => d.kind === "ORIGINAL");
  if (!original) throw new Error("original missing");
  const pdf = await downloadFile(original, original.sha256);
  if (!isPdf(pdf)) throw new Error("original is not a PDF");
  const png = await readSignatureImage(image); // the exact image version used is recorded below

  let signed: Buffer;
  try {
    signed = await stampSignature({ pdf, image: png, placement });
  } catch (e) {
    if (e instanceof SigningRefused) {
      await needsAttention(contractId, "REVIEW", e.message);
      return { signed: false, reason: e.message };
    }
    throw e;
  }

  const stored = await uploadFile(`${storageRoot()}/Signed/${contractId}`, signedName(c.attachmentName), signed);
  await db.documentRef.upsert({
    where: { contractId_kind: { contractId, kind: "SIGNED" } },
    create: { contractId, kind: "SIGNED", driveId: stored.driveId, itemId: stored.itemId, sha256: stored.sha256 },
    // A retry after upload but before this write re-signs; the ref must follow the file now at that path.
    update: { driveId: stored.driveId, itemId: stored.itemId, sha256: stored.sha256 },
  });
  await setStatus(contractId, "SIGNED");
  await audit(
    contractId,
    "signed",
    { by: authority.by, placement, signatureImageVersion: image.version, signatureImageSha256: image.sha256 },
    authority.by === "owner" ? authority.actor : "system",
  );
  return { signed: true };
}

export const signedName = (name: string) => {
  const base = name.replace(/\.pdf$/i, "");
  return `${base} (signed).pdf`;
};
