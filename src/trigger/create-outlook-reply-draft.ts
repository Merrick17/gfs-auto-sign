import { task } from "@trigger.dev/sdk";
import { contractCatchError, markContractFailed } from "./contract-failure";
import { createReplyDraft } from "@/lib/drafts";

// Step 4: save the reply draft with the signed copy. Never sends.
export const createOutlookReplyDraft = task({
  id: "create-outlook-reply-draft",
  queue: { name: "drafts", concurrencyLimit: 3 },
  retry: { maxAttempts: 5, factor: 2, minTimeoutInMs: 3000, maxTimeoutInMs: 90000 },
  catchError: contractCatchError,
  onFailure: markContractFailed,
  run: ({ contractId }: { contractId: string }) => createReplyDraft(contractId),
});
