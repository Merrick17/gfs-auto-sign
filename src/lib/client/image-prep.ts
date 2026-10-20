// Pure pixel helpers for preparing a signature photo. They work on RGBA arrays so they can be tested without a browser.

export type Pixels = { data: Uint8ClampedArray | Uint8Array | number[]; width: number; height: number };
export type Bounds = { x: number; y: number; width: number; height: number };

export const DEFAULT_WHITE_LEVEL = 240;
const MIN_INK_ALPHA = 24;

const minChannel = (d: Pixels["data"], i: number) => Math.min(d[i], d[i + 1], d[i + 2]);

// Turns near-white pixels transparent with a soft edge so thin pen strokes keep smooth outlines.
// A pixel at or above `threshold` becomes fully transparent; one `softness` below it stays fully opaque.
export function removeBackground(px: Pixels, opts: { threshold?: number; softness?: number } = {}): void {
  const threshold = opts.threshold ?? DEFAULT_WHITE_LEVEL;
  const softness = Math.max(1, opts.softness ?? 50);
  const { data } = px;
  for (let i = 0; i < px.width * px.height * 4; i += 4) {
    const keep = Math.min(1, Math.max(0, (threshold - minChannel(data, i)) / softness));
    data[i + 3] = Math.round(data[i + 3] * keep);
  }
}

// Smallest rectangle containing visible, non-white pixels. Null when the image has no ink at all.
export function findInkBounds(px: Pixels, opts: { whiteLevel?: number } = {}): Bounds | null {
  const whiteLevel = opts.whiteLevel ?? DEFAULT_WHITE_LEVEL;
  const { data, width, height } = px;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] >= MIN_INK_ALPHA && minChannel(data, i) < whiteLevel) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// Adds breathing room around the ink without leaving the image.
export function padBounds(b: Bounds, imageWidth: number, imageHeight: number, padding: number): Bounds {
  const x = Math.max(0, b.x - padding);
  const y = Math.max(0, b.y - padding);
  const right = Math.min(imageWidth, b.x + b.width + padding);
  const bottom = Math.min(imageHeight, b.y + b.height + padding);
  return { x, y, width: right - x, height: bottom - y };
}

export const inkPadding = (b: Bounds) => Math.max(4, Math.round(b.height * 0.08));

// Never upscales.
export function fitWidth(width: number, height: number, maxWidth: number): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  const scale = maxWidth / width;
  return { width: maxWidth, height: Math.max(1, Math.round(height * scale)) };
}
