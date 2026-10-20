import assert from "node:assert/strict";
import { test } from "node:test";
import { fitWidth, findInkBounds, padBounds, removeBackground, type Pixels } from "./client/image-prep";

const rgba = (width: number, height: number, fill: [number, number, number, number]): Pixels => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { data, width, height };
};
const set = (px: Pixels, x: number, y: number, c: [number, number, number, number]) => {
  (px.data as Uint8ClampedArray).set(c, (y * px.width + x) * 4);
};
const alphaAt = (px: Pixels, x: number, y: number) => px.data[(y * px.width + x) * 4 + 3];

test("removeBackground makes white transparent and keeps dark ink opaque", () => {
  const px = rgba(3, 1, [255, 255, 255, 255]);
  set(px, 1, 0, [10, 10, 40, 255]);
  removeBackground(px);
  assert.equal(alphaAt(px, 0, 0), 0);
  assert.equal(alphaAt(px, 1, 0), 255);
});

test("removeBackground softens the edge between white and ink", () => {
  const px = rgba(1, 1, [215, 215, 215, 255]);
  removeBackground(px, { threshold: 240, softness: 50 });
  const a = alphaAt(px, 0, 0);
  assert.ok(a > 0 && a < 255, `expected a partial alpha, got ${a}`);
});

test("removeBackground treats a coloured stroke as ink even when other channels are bright", () => {
  const px = rgba(1, 1, [20, 250, 250, 255]);
  removeBackground(px);
  assert.equal(alphaAt(px, 0, 0), 255);
});

test("removeBackground keeps existing transparency", () => {
  const px = rgba(1, 1, [0, 0, 0, 0]);
  removeBackground(px);
  assert.equal(alphaAt(px, 0, 0), 0);
});

test("findInkBounds returns the ink rectangle on a white page", () => {
  const px = rgba(10, 8, [255, 255, 255, 255]);
  set(px, 2, 3, [0, 0, 0, 255]);
  set(px, 6, 5, [0, 0, 0, 255]);
  assert.deepEqual(findInkBounds(px), { x: 2, y: 3, width: 5, height: 3 });
});

test("findInkBounds ignores transparent pixels even when their colour is dark", () => {
  const px = rgba(6, 6, [0, 0, 0, 0]);
  set(px, 4, 4, [0, 0, 0, 255]);
  assert.deepEqual(findInkBounds(px), { x: 4, y: 4, width: 1, height: 1 });
});

test("findInkBounds returns null for a blank image", () => {
  assert.equal(findInkBounds(rgba(5, 5, [255, 255, 255, 255])), null);
  assert.equal(findInkBounds(rgba(5, 5, [0, 0, 0, 0])), null);
});

test("padBounds adds padding and stays inside the image", () => {
  assert.deepEqual(padBounds({ x: 2, y: 3, width: 5, height: 3 }, 10, 8, 4), { x: 0, y: 0, width: 10, height: 8 });
  assert.deepEqual(padBounds({ x: 20, y: 20, width: 10, height: 10 }, 100, 100, 4), { x: 16, y: 16, width: 18, height: 18 });
});

test("fitWidth downscales proportionally and never upscales", () => {
  assert.deepEqual(fitWidth(2400, 600, 1200), { width: 1200, height: 300 });
  assert.deepEqual(fitWidth(800, 200, 1200), { width: 800, height: 200 });
});
