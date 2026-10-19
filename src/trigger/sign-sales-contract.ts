import { task } from "@trigger.dev/sdk";
import { signContract } from "@/lib/signing";
import { storeSignedDocument } from "./store-signed-document";

export const signSalesContract = task({
  id: "sign-sales-contract",
  queue: { name: "signing", concurrencyLimit: 2 },
  maxDuration: 300,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 60000 },
  run: ({ contractId }: { contractId: string }) =>
    signContract(contractId, () =>
      storeSignedDocument.trigger({ contractId }, { idempotencyKey: `store:${contractId}`, tags: ["gfs", `contract_${contractId}`] }),
    ),
});
