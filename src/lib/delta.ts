import { getDb } from "./db";
import { requireEnv } from "./env";
import { graph, mailboxPath } from "./graph";
import { messageDedupeKey } from "./graph-notifications";
import { dispatchEvent } from "./dispatch";

type DeltaPage = {
  value: { id: string; "@removed"?: unknown }[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

const KEY = "inboxDeltaLink";

// Recovery only: runs after a `missed` notification, a removed subscription or an outage.
// Found messages enter the same inbox table (same dedupe key as webhook deliveries) and dispatch path.
export async function syncInboxDelta() {
  const db = getDb();
  const mailbox = await db.mailboxConnection.findUniqueOrThrow({ where: { mailboxId: requireEnv("MAILBOX_ID") } });
  const sub = await db.graphSubscription.findFirst({ where: { mailboxId: mailbox.id }, orderBy: { createdAt: "desc" } });
  const saved = await db.appSetting.findUnique({ where: { key: KEY } });

  let url = (saved?.value as string | undefined) ??
    `${mailboxPath()}/mailFolders('Inbox')/messages/delta?$select=id&changeType=created`;
  const firstRun = !saved;
  let found = 0;
  let deltaLink: string | undefined;

  while (url) {
    const page = await graph<DeltaPage>(url);
    // The first pass only establishes the baseline; older mail is not backfilled as contracts.
    if (!firstRun) {
      for (const m of page.value) {
        if (m["@removed"]) continue;
        const key = messageDedupeKey(mailbox.id, m.id);
        const row = await db.incomingEvent.upsert({
          where: { dedupeKey: key },
          create: {
            mailboxId: mailbox.id, dedupeKey: key, kind: "message.created", graphMessageId: m.id,
            subscriptionId: sub?.graphId ?? "delta", payload: { source: "delta-sync", id: m.id },
          },
          update: {},
        });
        if (row.dispatchStatus === "PENDING") {
          await dispatchEvent(row.id);
          found++;
        }
      }
    }
    if (page["@odata.deltaLink"]) deltaLink = page["@odata.deltaLink"];
    url = page["@odata.nextLink"] ?? "";
  }
  if (deltaLink) await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: deltaLink }, update: { value: deltaLink } });
  return { baseline: firstRun, recovered: found };
}
