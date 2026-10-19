import { task } from "@trigger.dev/sdk";
import { analyzeContract } from "@/lib/analysis";
import { authorizeContract } from "./authorize-contract-signing";

export const analyzeSalesContract = task({
  id: "analyze-sales-contract",
  queue: { name: "analysis", concurrencyLimit: 4 },
  maxDuration: 600,
  retry: { maxAttempts: 4, factor: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 120000 },
  run: ({ contractId }: { contractId: string }) =>
    analyzeContract(contractId, () =>
      authorizeContract.trigger({ contractId }, { idempotencyKey: `authorize:${contractId}`, tags: ["gfs", `contract_${contractId}`] }),
    ),
});
