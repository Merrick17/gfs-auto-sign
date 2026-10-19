import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const notificationBatch = z.object({
  value: z.array(
    z.object({
      subscriptionId: z.string(),
      subscriptionExpirationDateTime: z.string().optional(),
      changeType: z.string().optional(),
      clientState: z.string().optional(),
      tenantId: z.string().optional(),
      resource: z.string().optional(),
      resourceData: z.object({ id: z.string().optional() }).passthrough().optional(),
      lifecycleEvent: z.string().optional(),
    }).passthrough(),
  ),
});

export type GraphNotification = z.infer<typeof notificationBatch>["value"][number];

export function safeEqual(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function messageDedupeKey(mailboxId: string, messageId: string): string {
  return `msg|${mailboxId}|${messageId}`;
}

export function dedupeKey(n: GraphNotification, mailboxId: string): string {
  if (n.lifecycleEvent) {
    return ["lc", n.subscriptionId, n.lifecycleEvent, n.subscriptionExpirationDateTime ?? ""].join("|");
  }
  return messageDedupeKey(mailboxId, n.resourceData?.id ?? n.resource ?? "");
}
