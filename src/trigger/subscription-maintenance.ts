import { schedules, task } from "@trigger.dev/sdk";
import { getDb } from "@/lib/db";
import { createSubscription, ensureSubscription, renewSubscription } from "@/lib/subscriptions";
import { deltaSync } from "./delta-sync";

// Maintenance only: renews Graph subscriptions. It never discovers contracts.
export const renewSubscriptions = schedules.task({
  id: "renew-graph-subscriptions",
  cron: { pattern: "0 */6 * * *", window: "30m" },
  run: async () => {
    const db = getDb();
    const due = await db.graphSubscription.findMany({
      where: { status: "active", expiresAt: { lt: new Date(Date.now() + 24 * 3600_000) } },
    });
    const out: Record<string, string> = {};
    for (const s of due) out[s.graphId] = await renewSubscription(s.graphId);
    const active = await db.graphSubscription.count({ where: { status: "active" } });
    if (active === 0) out.ensure = await ensureSubscription();
    return out;
  },
});

// Triggered by lifecycle notifications (reauthorizationRequired, subscriptionRemoved, missed).
export const handleLifecycle = task({
  id: "handle-subscription-lifecycle",
  run: async (p: { event: string; subscriptionId: string }) => {
    if (p.event === "reauthorizationRequired") return renewSubscription(p.subscriptionId);
    if (p.event === "subscriptionRemoved") {
      await getDb().graphSubscription.updateMany({
        where: { graphId: p.subscriptionId },
        data: { status: "removed" },
      });
      await createSubscription();
      await deltaSync.trigger(undefined, { idempotencyKey: `delta:${p.subscriptionId}` });
      return "recreated";
    }
    if (p.event === "missed") {
      await deltaSync.trigger(undefined, { idempotencyKey: `delta-missed:${Date.now() / 600000 | 0}` });
      return "delta sync started";
    }
    return "noop";
  },
});
