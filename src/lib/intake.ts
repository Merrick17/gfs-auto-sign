import { getDb } from "./db";
import { graph, mailboxPath } from "./graph";
import { MAX_PDF_BYTES, isPdf } from "./limits";
import { audit, setStage } from "./pipeline";
import { sha256, storageRoot, uploadFile } from "./sharepoint";

type Message = { id: string; subject?: string; conversationId?: string; hasAttachments: boolean; isDraft?: boolean };
type Attachment = { id: string; name: string; size: number; contentType: string; "@odata.type": string; isInline?: boolean };

// Turns one accepted mailbox event into Contract rows and queues analysis for each new PDF.
export async function processEmailEvent(eventId: string, enqueueAnalysis: (contractId: string) => Promise<unknown>) {
  const db = getDb();
  const event = await db.incomingEvent.findUniqueOrThrow({ where: { id: eventId }, include: { mailbox: true } });
  const job = await db.processingJob.upsert({
    where: { eventId: event.id },
    create: { eventId: event.id },
    update: {},
  });
  if (job.status === "COMPLETED") return { skipped: "already processed" };
  if (!event.graphMessageId) throw new Error("event has no message id");

  const msgPath = `${mailboxPath()}/messages/${encodeURIComponent(event.graphMessageId)}`;
  const msg = await graph<Message>(`${msgPath}?$select=id,subject,conversationId,hasAttachments,isDraft`);
  if (!msg.hasAttachments || msg.isDraft) {
    await db.processingJob.update({ where: { id: job.id }, data: { stage: "IGNORED", status: "COMPLETED" } });
    return { ignored: "no attachments" };
  }

  const atts = (await graph<{ value: Attachment[] }>(`${msgPath}/attachments?$select=id,name,size,contentType,isInline`)).value;
  const pdfs = atts.filter(
    (a) => a["@odata.type"] === "#microsoft.graph.fileAttachment" && !a.isInline &&
      (a.contentType === "application/pdf" || a.name.toLowerCase().endsWith(".pdf")),
  );

  const created: string[] = [];
  for (const a of pdfs) {
    if (a.size > MAX_PDF_BYTES) {
      await audit(null, "attachment:rejected-size", { messageId: msg.id, attachmentId: a.id });
      continue;
    }
    const bytes = Buffer.from(await graph<ArrayBuffer>(`${msgPath}/attachments/${a.id}/$value`, { raw: true }));
    if (!isPdf(bytes)) {
      await audit(null, "attachment:rejected-not-pdf", { messageId: msg.id, attachmentId: a.id });
      continue;
    }
    const hash = sha256(bytes);
    const where = { mailboxId_graphMessageId_attachmentId_contentHash: {
      mailboxId: event.mailboxId, graphMessageId: msg.id, attachmentId: a.id, contentHash: hash } };
    let contract = await db.contract.findUnique({ where });
    if (!contract) {
      contract = await db.contract.upsert({
        where,
        update: {},
        create: {
          mailboxId: event.mailboxId, graphMessageId: msg.id, attachmentId: a.id,
          attachmentName: a.name, contentHash: hash, conversationId: msg.conversationId,
        },
      });
    }
    // Original is stored once; the DocumentRef unique key makes retries no-ops.
    const hasOriginal = await db.documentRef.findUnique({ where: { contractId_kind: { contractId: contract.id, kind: "ORIGINAL" } } });
    if (!hasOriginal) {
      const stored = await uploadFile(`${storageRoot()}/Original/${contract.id}`, a.name, bytes);
      await db.documentRef.upsert({
        where: { contractId_kind: { contractId: contract.id, kind: "ORIGINAL" } },
        create: { contractId: contract.id, kind: "ORIGINAL", driveId: stored.driveId, itemId: stored.itemId, sha256: stored.sha256 },
        update: {},
      });
    }
    await setStage(contract.id, "EMAIL_RECEIVED", { status: "RECEIVED" });
    created.push(contract.id);
  }

  for (const id of created) {
    const c = await db.contract.findUniqueOrThrow({ where: { id } });
    if (c.status !== "RECEIVED") continue; // already advanced by an earlier attempt
    await enqueueAnalysis(id);
  }

  await db.processingJob.update({
    where: { id: job.id },
    data: { stage: created.length ? "DISPATCHED" : "IGNORED", status: "COMPLETED", detail: { contracts: created.length } },
  });
  return { contracts: created };
}
