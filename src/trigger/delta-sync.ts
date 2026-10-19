import { task } from "@trigger.dev/sdk";
import { syncInboxDelta } from "@/lib/delta";

// Recovery only: runs after a `missed` notification, a removed subscription or an outage.
export const deltaSync = task({
  id: "inbox-delta-sync",
  queue: { name: "maintenance", concurrencyLimit: 1 },
  retry: { maxAttempts: 4, factor: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 120000 },
  run: () => syncInboxDelta(),
});
