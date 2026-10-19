import { metadata } from "@trigger.dev/sdk";
import { getDb } from "./db";

export type Stage =
  | "EMAIL_RECEIVED" | "REVIEWING" | "EVALUATING" | "SIGNING" | "VERIFYING"
  | "UPLOADING" | "CREATING_DRAFT" | "COMPLETED" | "REQUIRES_REVIEW" | "FAILED" | "IGNORED";

export const audit = (contractId: string | null, action: string, data?: object, actor = "system") =>
  getDb().auditEvent.create({ data: { contractId, actor, action, data: data as never } });

// Persists the stage in Neon and mirrors it to run metadata for Trigger.dev Realtime.
export async function setStage(contractId: string, stage: Stage, extra: { status?: string; exception?: string } = {}) {
  await getDb().contract.update({
    where: { id: contractId },
    data: { stage, ...(extra.status ? { status: extra.status } : {}), ...(extra.exception ? { exception: extra.exception } : {}) },
  });
  try {
    metadata.set("stage", stage);
  } catch {
    // not inside a run (tests/scripts)
  }
  await audit(contractId, `stage:${stage}`, extra.exception ? { reason: extra.exception } : undefined);
}
