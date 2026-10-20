import { schedules } from "@trigger.dev/sdk";
import { retryFailedDocuments } from "@/lib/auto-retry";
import { createOutlookReplyDraft } from "./create-outlook-reply-draft";
import { processDocumentTask } from "./process-document";

// Automatic retry: failed documents are picked up again after 5, 10 and 20 minutes, then left for the owner.
export const retryFailedDocumentsTask = schedules.task({
  id: "retry-failed-documents",
  cron: { pattern: "*/5 * * * *", window: "2m" },
  run: () =>
    retryFailedDocuments((contractId, kind, attempt) => {
      const opts = { idempotencyKey: `auto-retry:${contractId}:${attempt}`, tags: ["gfs", `contract_${contractId}`] };
      return kind === "draft" ? createOutlookReplyDraft.trigger({ contractId }, opts) : processDocumentTask.trigger({ contractId }, opts);
    }),
});
