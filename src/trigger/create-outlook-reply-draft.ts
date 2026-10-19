import { task } from "@trigger.dev/sdk";
import { createReplyDraft } from "@/lib/drafts";
import { GraphError } from "@/lib/graph";
import { AuthRequired } from "@/lib/graph-token";

export const createOutlookReplyDraft = task({
  id: "create-outlook-reply-draft",
  queue: { name: "drafts", concurrencyLimit: 3 },
  retry: { maxAttempts: 5, factor: 2, minTimeoutInMs: 3000, maxTimeoutInMs: 90000 },
  catchError: ({ error }) => {
    if (error instanceof AuthRequired) return { skipRetrying: true };
    if (error instanceof GraphError && error.retryAfterMs) return { retryAt: new Date(Date.now() + error.retryAfterMs) };
  },
  run: ({ contractId }: { contractId: string }) => createReplyDraft(contractId),
});
