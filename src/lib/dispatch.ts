import { tasks } from "@trigger.dev/sdk";
import { getDb } from "./db";
import type { outlookEmailReceived } from "@/trigger/outlook-email-received";
import type { handleLifecycle } from "@/trigger/subscription-maintenance";

// Hands one accepted event to Trigger.dev. The idempotency key makes retries safe.
export async function dispatchEvent(eventId: string): Promise<boolean> {
  const db = getDb();
  const e = await db.incomingEvent.findUniqueOrThrow({ where: { id: eventId } });
  try {
    const opts = { idempotencyKey: `event:${e.id}` };
    const handle =
      e.kind === "lifecycle"
        ? await tasks.trigger<typeof handleLifecycle>(
            "handle-subscription-lifecycle",
            {
              event: (e.payload as { lifecycleEvent: string }).lifecycleEvent,
              subscriptionId: e.subscriptionId,
            },
            opts,
          )
        : await tasks.trigger<typeof outlookEmailReceived>("outlook-email-received", { eventId: e.id }, opts);
    await db.incomingEvent.update({
      where: { id: e.id },
      data: { dispatchStatus: "DISPATCHED", triggerRunId: handle.id, dispatchedAt: new Date() },
    });
    return true;
  } catch {
    await db.incomingEvent.update({ where: { id: e.id }, data: { attempts: { increment: 1 } } });
    return false;
  }
}
