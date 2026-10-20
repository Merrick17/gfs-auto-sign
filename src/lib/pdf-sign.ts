import { PDFDocument, degrees } from "pdf-lib";
import type { Placement } from "./placement";

// A visual signature: the owner's signature image drawn onto the page. It is not a certificate-based
// digital signature and is never described as one.

export class SigningRefused extends Error {}

const latin1 = (b: Buffer) => b.toString("latin1");

// Reasons a PDF must not be rewritten. Returned as one sentence for the owner, or null when it can be signed.
export function unsignableReason(pdf: Buffer): string | null {
  const text = latin1(pdf);
  if (/\/Encrypt\s/.test(text)) return "This PDF is password-protected, so a signature can't be added.";
  if (/\/ByteRange\s*\[/.test(text)) return "This PDF already carries a digital signature that adding an image would break. Sign it in Outlook or Acrobat instead.";
  if (/\/Perms\s*<</.test(text) || /\/DocMDP/.test(text)) return "This PDF is locked against changes, so a signature can't be added.";
  return null;
}

export async function pageCount(pdf: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false, ignoreEncryption: true });
  return doc.getPageCount();
}

const isPng = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

// Returns a new PDF; the original bytes are never modified.
export async function stampSignature(opts: { pdf: Buffer; image: Buffer; placement: Placement }): Promise<Buffer> {
  const reason = unsignableReason(opts.pdf);
  if (reason) throw new SigningRefused(reason);
  const doc = await PDFDocument.load(opts.pdf, { updateMetadata: false });
  const l = opts.placement;
  if (l.page < 1 || l.page > doc.getPageCount()) throw new SigningRefused("The signature position is on a page this document doesn't have.");
  if (l.x < 0 || l.y < 0 || l.width <= 0 || l.height <= 0 || l.x + l.width > 1.0001 || l.y + l.height > 1.0001)
    throw new SigningRefused("The signature position is outside the page.");

  const page = doc.getPage(l.page - 1);
  const img = isPng(opts.image) ? await doc.embedPng(opts.image) : await doc.embedJpg(opts.image);
  page.drawImage(img, imageRect(page.getCropBox(), page.getRotation().angle, l, img.width / img.height));
  return Buffer.from(await doc.save());
}

// Placement fractions describe the page as displayed (rotation applied, origin top-left). Returns where to draw
// the image in page space, rotated so it reads upright on screen, scaled to fit the box and centred in it.
export function imageRect(box: { x: number; y: number; width: number; height: number }, angle: number, l: Placement, aspect: number) {
  const r = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  const { x: x0, y: y0, width: W, height: H } = box;
  const [dw, dh] = r === 90 || r === 270 ? [H, W] : [W, H];
  const bw = l.width * dw;
  const bh = l.height * dh;
  const fw = Math.min(bw, bh * aspect);
  const fh = fw / aspect;
  // The image's lower-left corner, in displayed coordinates (y grows downwards).
  const du = l.x * dw + (bw - fw) / 2;
  const dv = l.y * dh + (bh - fh) / 2 + fh;
  const at =
    r === 90 ? { x: x0 + dv, y: y0 + du }
    : r === 180 ? { x: x0 + W - du, y: y0 + dv }
    : r === 270 ? { x: x0 + W - dv, y: y0 + H - du }
    : { x: x0 + du, y: y0 + H - dv };
  return { ...at, width: fw, height: fh, rotate: degrees(r) };
}
