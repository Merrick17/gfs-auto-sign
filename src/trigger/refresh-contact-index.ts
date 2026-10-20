import { schedules } from "@trigger.dev/sdk";
import { syncContacts } from "@/lib/contacts";

// Keeps recipient suggestions fresh. Incremental: the sent-mail step only reads what was sent since the last run,
// and only recipient names and addresses are kept. It never reads message bodies.
export const refreshContactIndex = schedules.task({
  id: "refresh-contact-index",
  cron: { pattern: "30 3 * * *", window: "2h" },
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 30_000, maxTimeoutInMs: 300_000 },
  maxDuration: 600,
  run: () => syncContacts(),
});
