import type { Attention } from "./pipeline";
import type { Placement, RememberedPlacement } from "./placement";

export const RELIABLE_CONFIDENCE = 0.85;

export type DecisionInput = {
  extraction: { needsSignature: boolean; locations: Placement[]; suspicious: boolean; confidence: number } | null;
  pageCount: number;
  remembered: RememberedPlacement | null;
  autoSignAuthorized: boolean; // the owner turned automatic signing on in Settings
  senderAutoSign: boolean; // and allowed it for this sender
  hasSignatureImage: boolean;
  duplicateSigned: boolean; // the same file bytes were already signed
  unsignableReason: string | null;
};

export type Decision =
  | { kind: "sign"; placement: Placement; source: "remembered" | "detected" }
  | { kind: "attention"; attention: Attention; reason: string; suggestion: Placement | null }
  | { kind: "skip"; reason: string };

const onDocument = (p: Placement, pageCount: number) => p.page >= 1 && p.page <= pageCount;

// Deterministic. Nothing written inside the email or the PDF can turn signing on: only the owner's settings can.
export function decide(i: DecisionInput): Decision {
  const attention = (a: Attention, reason: string, suggestion: Placement | null = null): Decision => ({ kind: "attention", attention: a, reason, suggestion });

  if (i.unsignableReason) return attention("REVIEW", i.unsignableReason);
  if (i.extraction?.suspicious)
    return attention("REVIEW", "This document contains text addressed to an automated assistant. Check it before signing.", i.extraction.locations[0] ?? null);

  const remembered = i.remembered && i.remembered.pageCount === i.pageCount && onDocument(i.remembered, i.pageCount) ? i.remembered : null;
  if (!remembered && i.extraction && !i.extraction.needsSignature && i.extraction.confidence >= 0.7)
    return { kind: "skip", reason: "This doesn't look like a document you need to sign." };

  const detected = i.extraction?.locations.find((l) => onDocument(l, i.pageCount)) ?? null;
  const reliable: { placement: Placement; source: "remembered" | "detected" } | null = remembered
    ? { placement: remembered, source: "remembered" }
    : detected && i.extraction!.confidence >= RELIABLE_CONFIDENCE
      ? { placement: detected, source: "detected" }
      : null;
  const suggestion = reliable?.placement ?? detected;

  if (!i.hasSignatureImage) return attention("SETUP", "Add your signature image in Settings to sign this document.", suggestion);
  if (i.duplicateSigned) return attention("APPROVAL", "An identical file was already signed. Confirm before signing it again.", suggestion);
  if (!reliable) return attention("PLACEMENT", detected ? "Confirm where your signature goes." : "Choose where your signature goes.", suggestion);
  if (!i.autoSignAuthorized) return attention("APPROVAL", "Automatic signing is off. Check the position and approve.", suggestion);
  if (!i.senderAutoSign) return attention("APPROVAL", "Automatic signing isn't allowed for this sender. Check the position and approve.", suggestion);
  return { kind: "sign", ...reliable };
}
