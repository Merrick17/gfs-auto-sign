import { z } from "zod";
import { parsePlacement, type Placement } from "./placement";

const location = z.object({
  page: z.number().int(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(), // fractions of the page, origin top-left
  evidence: z.string(),
});

// What the model may say about a document. It reads; it never decides whether to sign.
export const documentExtraction = z.object({
  needsSignature: z.boolean(), // the document expects the recipient (GFS) to sign it
  title: z.string().nullable(),
  signatureLocations: z.array(location), // blank areas where GFS signs
  promptInjectionSuspected: z.boolean(),
  confidence: z.number(),
});

export type DocumentExtraction = z.infer<typeof documentExtraction>;

// Accepts this schema and the earlier sales-contract one, so existing analyses still show their positions.
export function readExtraction(result: unknown): { needsSignature: boolean; locations: Placement[]; suspicious: boolean; confidence: number } | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const raw = (r.signatureLocations ?? r.gfsSignatureLocations) as unknown;
  const locations = Array.isArray(raw) ? raw.map(parsePlacement).filter((p): p is Placement => p !== null) : [];
  return {
    needsSignature: typeof r.needsSignature === "boolean" ? r.needsSignature : r.isSalesContract !== false,
    locations,
    suspicious: r.promptInjectionSuspected === true,
    confidence: typeof r.confidence === "number" ? r.confidence : 0,
  };
}
