import { schedules } from "@trigger.dev/sdk";
import { getDb } from "@/lib/db";
import { dispatchEvent } from "@/lib/dispatch";

// Outbox relay: re-dispatches accepted events whose Trigger.dev dispatch failed.
// Maintenance only; it never reads the mailbox.
export const dispatchPendingEvents = schedules.task({
  id: "dispatch-pending-events",
  cron: "*/5 * * * *",
  run: async () => {
    const pending = await getDb().incomingEvent.findMany({
      where: { dispatchStatus: "PENDING", receivedAt: { lt: new Date(Date.now() - 30_000) } },
      take: 200,
      orderBy: { receivedAt: "asc" },
    });
    for (const e of pending) await dispatchEvent(e.id);
    return { relayed: pending.length };
  },
});
