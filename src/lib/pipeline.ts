import { metadata } from "@trigger.dev/sdk";
import OpenAI from "openai";
import { getDb } from "./db";
import { GraphError } from "./graph";
import { AuthRequired } from "./graph-token";

export type Status = "RECEIVED" | "NEEDS_ATTENTION" | "SKIPPED" | "SIGNING" | "SIGNED" | "DRAFTING" | "DRAFT_SAVED" | "FAILED";
export type Attention = "PLACEMENT" | "APPROVAL" | "REVIEW" | "SETUP";

// The four recorded steps of a run. Each one is written once, when it actually finished.
export type StepEvent = "received" | "ingested" | "signed" | "draft-saved";

export const audit = (contractId: string | null, action: string, data?: object, actor = "system") =>
  getDb().auditEvent.create({ data: { contractId, actor, action, data: data as never } });

const mirror = (status: string) => {
  try {
    metadata.set("status", status);
  } catch {
    // not inside a run (tests, server actions)
  }
};

export async function setStatus(contractId: string, status: Status, extra: { attention?: Attention; exception?: string } = {}) {
  await getDb().contract.update({
    where: { id: contractId },
    data: { status, attention: extra.attention ?? null, exception: extra.exception ?? null },
  });
  mirror(status);
}

// Stops the run and tells the owner, in one sentence, what is needed.
export async function needsAttention(contractId: string, attention: Attention, exception: string) {
  await setStatus(contractId, "NEEDS_ATTENTION", { attention, exception });
  await audit(contractId, "attention", { attention, reason: exception });
}

const className = (e: unknown) => {
  const n = e instanceof Error ? e.constructor.name || e.name : "";
  return /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(n) ? n : "UnknownError";
};

// A short sentence for the owner. Built only from the error's class and status, never its message,
// because messages can contain mail content, file paths or tokens.
export function failureReason(e: unknown): string {
  if (e instanceof AuthRequired) return "Your Microsoft 365 sign-in expired. Reconnect in Settings, then retry.";
  if (e instanceof GraphError) {
    if (e.status === 401 || e.status === 403) return "Microsoft 365 didn't allow access. Reconnect in Settings, then retry.";
    if (e.status === 404) return "The email or file is no longer in Outlook or OneDrive.";
    if (e.status === 400) return "Microsoft 365 refused this request. Retry, or contact support if it keeps happening.";
    return "Microsoft 365 was unavailable. Retry in a few minutes.";
  }
  if (e instanceof OpenAI.APIError) return "Reading the document failed. Retry, or place the signature yourself.";
  const name = e instanceof Error ? e.name : (e as { name?: unknown } | null)?.name;
  const code = (e as { code?: unknown } | null)?.code;
  if (name === "TimeoutError" || name === "AbortError" || code === "MAX_DURATION_EXCEEDED" || code === "ETIMEDOUT")
    return "Processing took too long. Retry to continue.";
  if (e instanceof Error && e.message === "SharePoint document hash mismatch") return "A stored file changed since it was saved.";
  return "Something went wrong while processing this document. Retry to continue.";
}

// Called when every retry is used up. Never throws: it runs inside a failure hook.
// A document that already finished or was skipped keeps its outcome.
export async function markFailed(contractId: string, error: unknown) {
  try {
    const changed = await getDb().contract.updateMany({
      where: { id: contractId, status: { notIn: ["DRAFT_SAVED", "SKIPPED", "NEEDS_ATTENTION"] } },
      data: { status: "FAILED", attention: null, exception: failureReason(error) },
    });
    mirror("FAILED");
    if (changed.count > 0) await audit(contractId, "failed", { error: className(error) });
  } catch {
    // The original failure is already recorded by Trigger.dev; never mask it.
  }
}
