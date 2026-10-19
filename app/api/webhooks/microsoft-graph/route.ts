import { getDb } from "@/lib/db";
import {
  dedupeKey,
  notificationBatch,
  safeEqual,
  type GraphNotification,
} from "@/lib/graph-notifications";
import { dispatchEvent } from "@/lib/dispatch";


// Graph subscription validation: echo the decoded token as text/plain within 10s.
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("validationToken");
  if (token !== null) {
    return new Response(token, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  const parsed = notificationBatch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad Request", { status: 400 });

  const accepted: string[] = [];
  for (const n of parsed.data.value) {
    const id = await accept(n);
    if (id) accepted.push(id);
  }

  // Dispatch after durable acceptance. A failure leaves rows PENDING for the outbox relay.
  await Promise.all(accepted.map(dispatchEvent));

  return new Response(null, { status: 202 });
}

async function accept(n: GraphNotification): Promise<string | null> {
  const sub = await getDb().graphSubscription.findUnique({ where: { graphId: n.subscriptionId } });
  if (!sub || !safeEqual(n.clientState, sub.clientState)) return null;
  const tenantId = (await getDb().mailboxConnection.findUnique({ where: { id: sub.mailboxId } }))?.tenantId;
  if (n.tenantId && n.tenantId !== tenantId) return null;

  const isLifecycle = Boolean(n.lifecycleEvent);
  const key = dedupeKey(n, sub.mailboxId);
  const existing = await getDb().incomingEvent.findUnique({ where: { dedupeKey: key } });
  if (existing) return existing.dispatchStatus === "PENDING" ? existing.id : null;

  try {
    const row = await getDb().incomingEvent.create({
      data: {
        mailboxId: sub.mailboxId,
        dedupeKey: key,
        kind: isLifecycle ? "lifecycle" : "message.created",
        graphMessageId: n.resourceData?.id ?? null,
        subscriptionId: n.subscriptionId,
        payload: JSON.parse(JSON.stringify(n)),
      },
    });
    return row.id;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return null; // concurrent duplicate delivery
    throw e;
  }
}

