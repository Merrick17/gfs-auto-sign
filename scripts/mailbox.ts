// Mailbox maintenance for the owner's account, using the same services as the app. Never sends mail.
//   npx tsx scripts/mailbox.ts purge-tests          delete every "[GFS TEST …]" message and draft left by test runs
//   npx tsx scripts/mailbox.ts import "<words>"      list inbox emails with attachments matching the words, then process them
//   npx tsx scripts/mailbox.ts import "<words>" --dry-run   list only
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

type Msg = { id: string; subject?: string; receivedDateTime?: string; hasAttachments?: boolean; isDraft?: boolean; from?: { emailAddress?: { address?: string } } };

async function main() {
  const { graph, mailboxPath } = await import("@/lib/graph");
  const [cmd, words, flag] = process.argv.slice(2);

  const search = async (path: string, query: string) => {
    const out: Msg[] = [];
    let url: string | undefined = `${path}?$search=${encodeURIComponent(`"${query.replace(/"/g, "")}"`)}&$select=id,subject,receivedDateTime,hasAttachments,isDraft,from&$top=50`;
    while (url && out.length < 1000) {
      const page: { value: Msg[]; "@odata.nextLink"?: string } = await graph(url);
      out.push(...page.value);
      url = page["@odata.nextLink"];
    }
    return out;
  };

  if (cmd === "purge-tests") {
    const hits = (await search(`${mailboxPath()}/messages`, "GFS TEST")).filter((m) => m.subject?.includes("[GFS TEST"));
    for (const m of hits) await graph(`${mailboxPath()}/messages/${m.id}`, { method: "DELETE" }).catch(() => undefined);
    console.log(`deleted ${hits.length} test messages and drafts`);
    return;
  }

  if (cmd === "import" && words) {
    const { getDb } = await import("@/lib/db");
    const { messageDedupeKey } = await import("@/lib/graph-notifications");
    const { processEmailEvent } = await import("@/lib/intake");
    const { processDocument } = await import("@/lib/processing");
    const { createReplyDraft } = await import("@/lib/drafts");
    const db = getDb();
    const me = process.env.MAILBOX_ID?.toLowerCase();
    if (!me) throw new Error("MAILBOX_ID must be set");

    const hits = (await search(`${mailboxPath()}/mailFolders('Inbox')/messages`, words)).filter((m) => m.hasAttachments && !m.isDraft);
    console.log(`${hits.length} inbox emails with attachments match "${words}"`);
    for (const m of hits) console.log(`  ${m.receivedDateTime?.slice(0, 10)}  ${m.from?.emailAddress?.address ?? "?"}  ${m.subject ?? "(no subject)"}`);
    if (flag === "--dry-run") return;

    const mailbox = await db.mailboxConnection.upsert({ where: { mailboxId: me }, create: { mailboxId: me, tenantId: process.env.AZURE_TENANT_ID ?? "t" }, update: {} });
    let docs = 0;
    for (const m of hits) {
      // Same dedupe key as the webhook: an email already received through a notification is not processed twice.
      const key = messageDedupeKey(mailbox.id, m.id);
      const ev =
        (await db.incomingEvent.findUnique({ where: { dedupeKey: key } })) ??
        (await db.incomingEvent.create({ data: { mailboxId: mailbox.id, dedupeKey: key, kind: "message.created", graphMessageId: m.id, subscriptionId: "import", payload: { source: "import" }, dispatchStatus: "DISPATCHED" } }));
      const queued: string[] = [];
      try {
        await processEmailEvent(ev.id, async (id) => void queued.push(id));
      } catch (e) {
        console.log(`  could not read "${m.subject}": ${(e as Error).name}`);
        continue;
      }
      for (const id of queued) {
        docs++;
        try {
          await processDocument(id, () => createReplyDraft(id));
        } catch (e) {
          const { markFailed } = await import("@/lib/pipeline");
          await markFailed(id, e);
        }
      }
    }
    const summary = await db.contract.groupBy({ by: ["status", "attention"], _count: true });
    console.log(`processed ${docs} new documents`);
    console.log(summary.map((s) => `  ${s.status}${s.attention ? `/${s.attention}` : ""}: ${s._count}`).join("\n"));
    return;
  }
  console.log('usage: purge-tests | import "<words>" [--dry-run]');
}

main().then(() => process.exit(0), (e) => { console.error("FATAL", (e as Error).message); process.exit(1); });
