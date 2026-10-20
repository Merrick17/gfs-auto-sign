import { fitWidth, findInkBounds, inkPadding, padBounds, removeBackground } from "./image-prep";

// Browser-only: decodes a picture, optionally clears the background, trims empty space and returns a PNG.
export class PrepareError extends Error {}

export const MAX_INPUT_BYTES = 15_000_000;
const MAX_OUTPUT_BYTES = 1_450_000;
const MAX_WIDTH = 1200;
const WORKING_WIDTH = 3000;

export function checkFile(file: File): string | null {
  if (!/^image\/(png|jpe?g)$/i.test(file.type)) return "That doesn't look like a PNG or JPG image. Please choose a picture of your signature.";
  if (file.size > MAX_INPUT_BYTES) return "That picture is too large. Please choose one under 15 MB.";
  return null;
}

export async function loadPixels(file: File): Promise<ImageData> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PrepareError("We couldn't read that image. Try a different file.");
  }
  const size = fitWidth(bitmap.width, bitmap.height, WORKING_WIDTH);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new PrepareError("Your browser can't prepare images. Try a different browser.");
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  return ctx.getImageData(0, 0, size.width, size.height);
}

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new PrepareError("We couldn't prepare that image."))), "image/png"));

export type Prepared = { blob: Blob; width: number; height: number };

export async function prepareSignature(source: ImageData, opts: { transparent: boolean }): Promise<Prepared> {
  const pixels = { data: new Uint8ClampedArray(source.data), width: source.width, height: source.height };
  if (opts.transparent) removeBackground(pixels);
  const ink = findInkBounds(pixels);
  if (!ink) throw new PrepareError("We couldn't find a signature in that image. Try a clearer picture on a plain background.");
  const crop = padBounds(ink, pixels.width, pixels.height, inkPadding(ink));

  const full = document.createElement("canvas");
  full.width = pixels.width;
  full.height = pixels.height;
  full.getContext("2d")!.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);

  let target = fitWidth(crop.width, crop.height, MAX_WIDTH);
  for (;;) {
    if (target.width < 120 || target.height < 40) throw new PrepareError("That signature is too small to be legible on a contract. Please use a larger, clearer picture.");
    const out = document.createElement("canvas");
    out.width = target.width;
    out.height = target.height;
    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(full, crop.x, crop.y, crop.width, crop.height, 0, 0, target.width, target.height);
    const blob = await toBlob(out);
    if (blob.size <= MAX_OUTPUT_BYTES) return { blob, width: target.width, height: target.height };
    target = { width: Math.round(target.width * 0.8), height: Math.round(target.height * 0.8) };
  }
}
