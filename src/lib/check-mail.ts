import { getDb } from "./db";
import { createReplyDraft } from "./drafts";
import { graph, mailboxPath } from "./graph";
import { messageDedupeKey } from "./graph-notifications";
import { processEmailEvent } from "./intake";
import { markFailed } from "./pipeline";
import { processDocument } from "./processing";

// "Check mail": looks at the last two weeks of the Outlook inbox for emails with attachments and runs any it has not
// seen through the same four steps as a notification would. Emails already received are skipped by the same
// dedupe key the webhook uses. It reads and creates drafts only; it never sends.

const DAYS = 14;
const MAX_EMAILS = 20;

type Msg = { id: string; isDraft?: boolean };

export async function checkMail(): Promise<{ emails: number; documents: number; newEmails: number }> {
  const db = getDb();
  const me = process.env.MAILBOX_ID?.toLowerCase();
  if (!me) throw new Error("MAILBOX_ID is not set");
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const filter = encodeURIComponent(`receivedDateTime ge ${since} and hasAttachments eq true`);
  const r = await graph<{ value: Msg[] }>(
    `${mailboxPath()}/mailFolders('Inbox')/messages?$filter=${filter}&$orderby=receivedDateTime desc&$select=id,isDraft&$top=50`,
  );
  const messages = r.value.filter((m) => !m.isDraft);

  const mailbox = await db.mailboxConnection.upsert({ where: { mailboxId: me }, create: { mailboxId: me, tenantId: process.env.AZURE_TENANT_ID ?? "t" }, update: {} });
  let newEmails = 0;
  let documents = 0;
  for (const m of messages) {
    if (newEmails >= MAX_EMAILS) break;
    const key = messageDedupeKey(mailbox.id, m.id);
    const existing = await db.incomingEvent.findUnique({ where: { dedupeKey: key }, include: { job: true } });
    if (existing?.job?.status === "COMPLETED") continue;
    newEmails++;
    const ev =
      existing ??
      (await db.incomingEvent.create({
        data: { mailboxId: mailbox.id, dedupeKey: key, kind: "message.created", graphMessageId: m.id, subscriptionId: "check-mail", payload: { source: "check-mail" }, dispatchStatus: "DISPATCHED" },
      }));
    const queued: string[] = [];
    try {
      await processEmailEvent(ev.id, async (id) => void queued.push(id));
    } catch {
      continue;
    }
    for (const id of queued) {
      documents++;
      try {
        await processDocument(id, () => createReplyDraft(id));
      } catch (e) {
        await markFailed(id, e);
      }
    }
  }
  return { emails: messages.length, newEmails, documents };
}
