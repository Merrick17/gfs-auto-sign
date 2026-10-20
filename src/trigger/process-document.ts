import { task } from "@trigger.dev/sdk";
import { contractCatchError, markContractFailed } from "./contract-failure";
import { processDocument } from "@/lib/processing";
import { createOutlookReplyDraft } from "./create-outlook-reply-draft";

// Steps 2 and 3: read the document, then add the signature when the owner's settings allow it.
export const processDocumentTask = task({
  id: "process-document",
  queue: { name: "documents", concurrencyLimit: 4 },
  maxDuration: 600,
  retry: { maxAttempts: 4, factor: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 120000 },
  catchError: contractCatchError,
  onFailure: markContractFailed,
  run: ({ contractId }: { contractId: string }) =>
    processDocument(contractId, () =>
      createOutlookReplyDraft.trigger({ contractId }, { idempotencyKey: `draft:${contractId}`, tags: ["gfs", `contract_${contractId}`] }),
    ),
});
