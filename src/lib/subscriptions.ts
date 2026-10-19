import { randomBytes } from "node:crypto";
import { getDb } from "./db";
import { requireEnv } from "./env";
import { mailboxKey } from "./mailbox";
import { graph, mailboxPath } from "./graph";

// Mail subscriptions allow up to 4230 minutes (~2.9 days).
const MAX_MINUTES = 4200;
const expiry = () => new Date(Date.now() + MAX_MINUTES * 60_000).toISOString();

type GraphSub = { id: string; expirationDateTime: string };

export async function createSubscription() {
  const db = getDb();
  const mailboxId = await mailboxKey();
  const mailbox = await db.mailboxConnection.upsert({
    where: { mailboxId },
    create: { mailboxId, tenantId: requireEnv("AZURE_TENANT_ID") },
    update: {},
  });
  const clientState = randomBytes(32).toString("hex");
  const base = requireEnv("APP_BASE_URL");
  const resource = `${mailboxPath()}/mailFolders('Inbox')/messages`;
  const s = await graph<GraphSub>("/subscriptions", {
    method: "POST",
    body: {
      changeType: "created",
      notificationUrl: `${base}/api/webhooks/microsoft-graph`,
      lifecycleNotificationUrl: `${base}/api/webhooks/microsoft-graph`,
      resource,
      expirationDateTime: expiry(),
      clientState,
    },
  });
  return db.graphSubscription.create({
    data: {
      graphId: s.id,
      mailboxId: mailbox.id,
      resource,
      clientState,
      expiresAt: new Date(s.expirationDateTime),
    },
  });
}

export async function renewSubscription(graphId: string) {
  const db = getDb();
  try {
    const s = await graph<GraphSub>(`/subscriptions/${graphId}`, {
      method: "PATCH",
      body: { expirationDateTime: expiry() },
    });
    await db.graphSubscription.update({
      where: { graphId },
      data: { expiresAt: new Date(s.expirationDateTime), status: "active" },
    });
    return "renewed" as const;
  } catch (e) {
    if ((e as { status?: number }).status === 404) {
      // Subscription is gone on Graph's side: recreate and mark the old one removed.
      await db.graphSubscription.update({ where: { graphId }, data: { status: "removed" } });
      await createSubscription();
      return "recreated" as const;
    }
    throw e;
  }
}

// The owner never manages subscriptions. This is called after sign-in and by the daily maintenance task.
// Graph only delivers notifications to a public HTTPS address, so a local or unpublished app cannot be watched.
export async function ensureSubscription(): Promise<"active" | "created" | "renewed" | "not-public"> {
  const base = process.env.APP_BASE_URL;
  if (!base || !base.startsWith("https://")) return "not-public";
  const db = getDb();
  const active = await db.graphSubscription.findFirst({ where: { status: "active" }, orderBy: { createdAt: "desc" } });
  if (!active) {
    await createSubscription();
    return "created";
  }
  if (active.expiresAt.getTime() - Date.now() > 24 * 3_600_000) return "active";
  await renewSubscription(active.graphId);
  return "renewed";
}
