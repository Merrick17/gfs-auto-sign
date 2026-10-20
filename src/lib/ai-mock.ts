import type { DocumentExtraction } from "./contract-schema";

// Test-only stand-in for the model, selected by attachment name. Never active in production.
export const aiMockEnabled = () => process.env.AI_MOCK === "1" && process.env.NODE_ENV !== "production";

const base = (over: Partial<DocumentExtraction>): DocumentExtraction => ({
  needsSignature: true,
  title: "Test agreement",
  signatureLocations: [{ page: 1, x: 0.1, y: 0.8, width: 0.3, height: 0.08, evidence: "GFS signature block" }],
  promptInjectionSuspected: false,
  confidence: 0.96,
  ...over,
});

export function mockExtraction(fileName: string): DocumentExtraction {
  const n = fileName.toUpperCase();
  if (n.includes("NOSIGN")) return base({ needsSignature: false, signatureLocations: [] });
  if (n.includes("NOSPOT")) return base({ signatureLocations: [], confidence: 0.4 });
  if (n.includes("UNSURE")) return base({ confidence: 0.5 });
  if (n.includes("INJECTION")) return base({ promptInjectionSuspected: true });
  return base({});
}
