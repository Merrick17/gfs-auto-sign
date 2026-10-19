import { task } from "@trigger.dev/sdk";
import { GraphError } from "@/lib/graph";
import { processEmailEvent } from "@/lib/intake";
import { analyzeSalesContract } from "./analyze-sales-contract";

export const outlookEmailReceived = task({
  id: "outlook-email-received",
  queue: { name: "email-intake", concurrencyLimit: 5 },
  retry: { maxAttempts: 5, factor: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 60000 },
  catchError: ({ error }) => {
    if (error instanceof GraphError && error.retryAfterMs) return { retryAt: new Date(Date.now() + error.retryAfterMs) };
    if (error instanceof GraphError && !error.retryable) return { skipRetrying: true };
  },
  run: (payload: { eventId: string }) =>
    processEmailEvent(payload.eventId, (id) =>
      analyzeSalesContract.trigger({ contractId: id }, { idempotencyKey: `analyze:${id}`, tags: ["gfs", `contract_${id}`] }),
    ),
});
