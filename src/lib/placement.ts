import { z } from "zod";

// Where the signature image goes, as fractions of the page with the origin top-left. Page is 1-based.
export const placementSchema = z
  .object({
    page: z.number().int().min(1).max(10_000),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0.02).max(1),
    height: z.number().min(0.01).max(1),
  })
  .refine((p) => p.x + p.width <= 1.0001 && p.y + p.height <= 1.0001, "The signature must stay on the page");

export type Placement = z.infer<typeof placementSchema>;

// A remembered position is only reused on documents with the same number of pages.
export type RememberedPlacement = Placement & { pageCount: number };

export function parsePlacement(v: unknown): Placement | null {
  const r = placementSchema.safeParse(v);
  return r.success ? r.data : null;
}

export function parseRemembered(v: unknown): RememberedPlacement | null {
  const p = parsePlacement(v);
  const pageCount = (v as { pageCount?: unknown } | null)?.pageCount;
  return p && typeof pageCount === "number" && Number.isInteger(pageCount) && pageCount > 0 ? { ...p, pageCount } : null;
}

// Starting point when nothing better is known: lower right of the last page.
export const defaultPlacement = (pageCount: number): Placement => ({ page: Math.max(1, pageCount), x: 0.58, y: 0.8, width: 0.3, height: 0.08 });
