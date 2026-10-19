import { createHash } from "node:crypto";
import { getDb } from "./db";
import { downloadFile, uploadFile } from "./sharepoint";

// Private app folder in the owner's OneDrive. Never shared by link.
export const APP_FOLDER = "Apps/GFS Contract Agent";
export const SIGNATURE_FOLDER = `${APP_FOLDER}/Signatures`;

export class SignatureImageError extends Error {}

const MAX_BYTES = 1_500_000;

export function inspectPng(bytes: Buffer): { width: number; height: number } {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(sig) || bytes.subarray(12, 16).toString("latin1") !== "IHDR")
    throw new SignatureImageError("That file isn't a PNG image.");
  if (bytes.length > MAX_BYTES) throw new SignatureImageError("That image is too large. Please use one under 1.5 MB.");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 120 || height < 40) throw new SignatureImageError("That image is too small to be legible on a contract.");
  if (width > 4000 || height > 2000) throw new SignatureImageError("That image is too large. Please use one under 4000 × 2000 pixels.");
  return { width, height };
}

export const getActiveSignatureImage = () => getDb().signatureImage.findFirst({ where: { active: true }, orderBy: { version: "desc" } });

// Each upload is a new version: the previous file stays in OneDrive so earlier signing records remain accurate.
export async function saveSignatureImage(bytes: Buffer, originalName: string) {
  const { width, height } = inspectPng(bytes);
  const db = getDb();
  const last = await db.signatureImage.findFirst({ orderBy: { version: "desc" } });
  const version = (last?.version ?? 0) + 1;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const stored = await uploadFile(SIGNATURE_FOLDER, `signature-v${version}-${sha256.slice(0, 8)}.png`, bytes, "image/png");
  const row = await db.$transaction(async (tx) => {
    await tx.signatureImage.updateMany({ where: { active: true }, data: { active: false } });
    return tx.signatureImage.create({
      data: { version, driveId: stored.driveId, itemId: stored.itemId, fileName: originalName.slice(0, 120), sha256, sizeBytes: bytes.length, width, height, active: true },
    });
  });
  await db.auditEvent.create({ data: { actor: "owner", action: "signature-image:uploaded", data: { version, sha256 } } });
  return row;
}

export async function removeSignatureImage() {
  const db = getDb();
  const active = await getActiveSignatureImage();
  if (!active) return;
  await db.signatureImage.update({ where: { id: active.id }, data: { active: false, removedAt: new Date() } });
  await db.auditEvent.create({ data: { actor: "owner", action: "signature-image:removed", data: { version: active.version } } });
}

export const readSignatureImage = (img: { driveId: string; itemId: string; sha256: string }) => downloadFile(img, img.sha256);
