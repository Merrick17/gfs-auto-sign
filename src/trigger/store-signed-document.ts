import { task } from "@trigger.dev/sdk";
import { storeSigned } from "@/lib/store";
import { createOutlookReplyDraft } from "./create-outlook-reply-draft";

export const storeSignedDocument = task({
  id: "store-signed-document",
  queue: { name: "storage", concurrencyLimit: 5 },
  retry: { maxAttempts: 5, factor: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 60000 },
  run: ({ contractId }: { contractId: string }) =>
    storeSigned(contractId, () =>
      createOutlookReplyDraft.trigger({ contractId }, { idempotencyKey: `draft:${contractId}`, tags: ["gfs", `contract_${contractId}`] }),
    ),
});
