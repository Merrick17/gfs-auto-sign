import { createHash } from "node:crypto";
import { requireEnv } from "./env";
import { graph } from "./graph";

export const sha256 = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");

type DriveItem = { id: string; size: number };
type UploadSession = { uploadUrl: string };

const safe = (s: string) => s.replace(/[\/:*?"<>|#%]/g, "_").slice(0, 120);
const SMALL = 4 * 1024 * 1024;
const CHUNK = 320 * 1024 * 10;

export type StoredFile = { driveId: string; itemId: string; sha256: string };

export async function uploadFile(folder: string, name: string, bytes: Buffer): Promise<StoredFile> {
  const driveId = requireEnv("SHAREPOINT_DRIVE_ID");
  const path = `${folder.split("/").map(safe).join("/")}/${safe(name)}`;
  const base = `/drives/${driveId}/root:/${encodeURI(path)}:`;
  let item: DriveItem;
  if (bytes.length < SMALL) {
    item = await graph<DriveItem>(`${base}/content`, {
      method: "PUT",
      bytes,
      headers: { "Content-Type": "application/pdf" },
    });
  } else {
    const { uploadUrl } = await graph<UploadSession>(`${base}/createUploadSession`, {
      method: "POST",
      body: { item: { "@microsoft.graph.conflictBehavior": "replace" } },
    });
    item = undefined as unknown as DriveItem;
    for (let start = 0; start < bytes.length; start += CHUNK) {
      const end = Math.min(start + CHUNK, bytes.length);
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Range": `bytes ${start}-${end - 1}/${bytes.length}` },
        body: new Uint8Array(bytes.subarray(start, end)),
      });
      if (!res.ok) throw new Error(`SharePoint chunk upload failed: ${res.status}`);
      if (end === bytes.length) item = (await res.json()) as DriveItem;
    }
  }
  return { driveId, itemId: item.id, sha256: sha256(bytes) };
}

export async function downloadFile(ref: { driveId: string; itemId: string }, expectedSha256?: string): Promise<Buffer> {
  const buf = Buffer.from(await graph<ArrayBuffer>(`/drives/${ref.driveId}/items/${ref.itemId}/content`, { raw: true }));
  if (expectedSha256 && sha256(buf) !== expectedSha256) throw new Error("SharePoint document hash mismatch");
  return buf;
}

// Everything the app writes lives under one folder, separate from existing document folders.
export const storageRoot = () => process.env.SHAREPOINT_ROOT_FOLDER || "GFS Contracts";
