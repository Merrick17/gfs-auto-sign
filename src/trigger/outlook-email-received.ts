import { task } from "@trigger.dev/sdk";
import { GraphError } from "@/lib/graph";
import { AuthRequired } from "@/lib/graph-token";
import { processEmailEvent } from "@/lib/intake";
import { processDocumentTask } from "./process-document";

// Step 1: one new email, one record per PDF attachment.
export const outlookEmailReceived = task({
  id: "outlook-email-received",
  queue: { name: "email-intake", concurrencyLimit: 5 },
  retry: { maxAttempts: 5, factor: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 60000 },
  catchError: ({ error }) => {
    if (error instanceof AuthRequired) return { skipRetrying: true };
    if (error instanceof GraphError && error.retryAfterMs) return { retryAt: new Date(Date.now() + error.retryAfterMs) };
    if (error instanceof GraphError && !error.retryable) return { skipRetrying: true };
  },
  run: (payload: { eventId: string }) =>
    processEmailEvent(payload.eventId, (id) =>
      processDocumentTask.trigger({ contractId: id }, { idempotencyKey: `process:${id}`, tags: ["gfs", `contract_${id}`] }),
    ),
});
