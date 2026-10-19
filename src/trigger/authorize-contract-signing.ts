import { task } from "@trigger.dev/sdk";
import { authorizeContractSigning } from "@/lib/authorization";
import { signSalesContract } from "./sign-sales-contract";

export const authorizeContract = task({
  id: "authorize-contract-signing",
  queue: { name: "authorization", concurrencyLimit: 10 },
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 1000, maxTimeoutInMs: 15000 },
  run: ({ contractId }: { contractId: string }) =>
    authorizeContractSigning(contractId, () =>
      signSalesContract.trigger({ contractId }, { idempotencyKey: `sign:${contractId}`, tags: ["gfs", `contract_${contractId}`] }),
    ),
});
