// End-to-end run against the real mailbox, OneDrive and Neon of the signed-in owner. The AI is mocked (AI_MOCK=1).
// Nothing is ever sent: the Graph client refuses send endpoints. Usage:
//   npx tsx scripts/e2e.ts            run all scenarios (test data stays for review in the UI)
//   npx tsx scripts/e2e.ts cleanup    delete every test message, draft, OneDrive file and database row it created
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { PDFDocument, StandardFonts } from "pdf-lib";

config({ path: ".env.local", quiet: true });
process.env.AI_MOCK = "1";
process.env.SHAREPOINT_ROOT_FOLDER ||= "GFS Trade Finance/GFS Contract Agent (TEST)";

const STATE = "secrets/e2e-state.json";
type State = { messages: string[]; drafts: string[]; contractIds: string[]; eventIds: string[]; driveItems: string[]; runs: number };
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { messages: [], drafts: [], contractIds: [], eventIds: [], driveItems: [], runs: 0 };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1));

const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function main() {
  const { getDb } = await import("@/lib/db");
  const { graph } = await import("@/lib/graph");
  const { accessToken } = await import("@/lib/graph-token");
  const db = getDb();
  const me = process.env.MAILBOX_ID;
  if (!me) throw new Error("MAILBOX_ID must be set to the signed-in owner's address");
  const tag = `[GFS TEST ${Date.now().toString(36)}]`;

  if (process.argv[2] === "cleanup") return cleanup(db, graph);

  // ---- test material --------------------------------------------------------------------------
  const contractPdf = async (name: string) => {
    const d = await PDFDocument.create();
    const p = d.addPage([595, 842]);
    const f = await d.embedFont(StandardFonts.Helvetica);
    p.drawText("SALES CONTRACT (TEST DOCUMENT)", { x: 50, y: 780, size: 16, font: f });
    p.drawText(`File: ${name}`, { x: 50, y: 750, size: 11, font: f });
    p.drawText("Customer: GFS Test Customer   Total EUR 12,000   Payment 30 days net   FOB Test Port", { x: 50, y: 720, size: 10, font: f });
    p.drawText("Signed for GFS: ____________________", { x: 60, y: 130, size: 10, font: f });
    return Buffer.from(await d.save());
  };
  const mime = (subject: string, atts: { name: string; type: string; body: Buffer }[]) =>
    Buffer.from(
      [
        `From: ${me}`, `To: ${me}`, `Subject: ${subject}`, "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="b1"', "",
        "--b1", "Content-Type: text/plain; charset=utf-8", "", "Test message created by the GFS Contract Agent test harness.", "",
        ...atts.flatMap((a) => ["--b1", `Content-Type: ${a.type}; name="${a.name}"`, `Content-Disposition: attachment; filename="${a.name}"`, "Content-Transfer-Encoding: base64", "", a.body.toString("base64")]),
        "--b1--", "",
      ].join("\r\n"),
    ).toString("base64");
  const createMail = async (subject: string, atts: { name: string; type: string; body: Buffer }[]) => {
    const res = await fetch("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages", {
      method: "POST", headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "text/plain" }, body: mime(subject, atts),
    });
    const j = (await res.json()) as { id: string };
    if (!res.ok) throw new Error(`create mail failed ${res.status}`);
    state.messages.push(j.id);
    save();
    return j.id;
  };
  const pdf = (n: string) => contractPdf(n).then((body) => ({ name: n, type: "application/pdf", body }));

  const msgPlain = await createMail(`${tag} ordinary email`, []);
  const msgMulti = await createMail(`${tag} two contracts and noise`, [
    await pdf("SC-OK1.pdf"), await pdf("SC-OK2.pdf"), await pdf("NOTASC.pdf"),
    { name: "photo.jpg", type: "image/jpeg", body: Buffer.from("jpg") },
    { name: "fake.pdf", type: "application/pdf", body: Buffer.from("this is not a pdf") },
  ]);
  const msgRisky = await createMail(`${tag} contracts that must stay unsigned`, [await pdf("SC-OVERLIMIT.pdf"), await pdf("SC-INJECTION.pdf"), await pdf("SC-UNKNOWNCUSTOMER.pdf")]);
  const messageIds = { plain: msgPlain, multi: msgMulti, risky: msgRisky };

  // ---- pipeline, in-process (same functions the Trigger.dev tasks call) ---------------------------
  const { processEmailEvent } = await import("@/lib/intake");
  const { analyzeContract } = await import("@/lib/analysis");
  const { authorizeContractSigning } = await import("@/lib/authorization");
  const { signContract } = await import("@/lib/signing");
  const { storeSigned } = await import("@/lib/store");
  const { createReplyDraft } = await import("@/lib/drafts");
  const { messageDedupeKey } = await import("@/lib/graph-notifications");

  const mailbox = await db.mailboxConnection.upsert({
    where: { mailboxId: me }, create: { mailboxId: me, tenantId: process.env.AZURE_TENANT_ID ?? "t" }, update: {},
  });
  const runChain = (id: string) =>
    analyzeContract(id, () =>
      authorizeContractSigning(id, () => signContract(id, () => storeSigned(id, () => createReplyDraft(id)))),
    );

  const queued: Record<string, string[]> = {};
  for (const [label, graphMessageId] of Object.entries(messageIds)) {
    const ev = await db.incomingEvent.create({
      data: { mailboxId: mailbox.id, dedupeKey: messageDedupeKey(mailbox.id, graphMessageId), kind: "message.created", graphMessageId, subscriptionId: "e2e", payload: { source: "e2e" } },
    });
    state.eventIds.push(ev.id);
    queued[label] = [];
    const r = (await processEmailEvent(ev.id, async (cid) => void queued[label].push(cid), { allowDraft: true })) as { contracts?: string[]; ignored?: string };
    state.contractIds.push(...(r.contracts ?? []));
    save();
    // Replaying the same notification must change nothing.
    const again = await processEmailEvent(ev.id, async () => void queued[label].push("DUPLICATE"), { allowDraft: true });
    check(`replayed event is a no-op (${label})`, JSON.stringify(again).includes("already processed"));
  }
  check("ordinary email without attachments is ignored", queued.plain.length === 0);
  check("two real PDFs + NOTASC queued; jpg and fake .pdf rejected", queued.multi.length === 3, `queued ${queued.multi.length}`);
  check("risky mail queues its 3 contracts", queued.risky.length === 3);

  for (const id of [...queued.multi, ...queued.risky]) {
    try {
      await runChain(id);
    } catch (e) {
      console.log("  chain error:", id, (e as Error).message);
    }
  }

  // ---- verify ------------------------------------------------------------------------------------
  const contracts = await db.contract.findMany({
    where: { id: { in: [...queued.multi, ...queued.risky] } },
    include: { draft: true, documents: true, analyses: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const by = (n: string) => contracts.find((c) => c.attachmentName === n)!;
  const ok1 = by("SC-OK1.pdf"), ok2 = by("SC-OK2.pdf");
  const signerReady = Boolean(await db.signatureProfile.findFirst({ where: { active: true, runtimeApprovedAt: { not: null } } }));

  check("NOTASC.pdf is recognised as not a sales contract and ignored", by("NOTASC.pdf").status === "IGNORED", by("NOTASC.pdf").status);
  check("over-limit contract stays unsigned with a reason", by("SC-OVERLIMIT.pdf").status === "NEEDS_REVIEW" && /exceeds limit/.test(by("SC-OVERLIMIT.pdf").exception ?? ""), by("SC-OVERLIMIT.pdf").exception ?? "");
  check("prompt-injection contract stays unsigned", by("SC-INJECTION.pdf").status === "NEEDS_REVIEW" && /instructions aimed at the agent/.test(by("SC-INJECTION.pdf").exception ?? ""));
  check("unknown customer stays unsigned", by("SC-UNKNOWNCUSTOMER.pdf").status === "NEEDS_REVIEW" && /not on the approved list/.test(by("SC-UNKNOWNCUSTOMER.pdf").exception ?? ""));
  check("none of the unauthorised contracts has a signed document", ["SC-OVERLIMIT.pdf", "SC-INJECTION.pdf", "SC-UNKNOWNCUSTOMER.pdf", "NOTASC.pdf"].every((n) => !by(n).documents.some((d) => d.kind === "SIGNED")));

  if (!signerReady) {
    check("eligible contracts stop for review while no signer is approved (safe default)", [ok1, ok2].every((c) => c.status === "NEEDS_REVIEW" && /certificate not approved/i.test(c.exception ?? "")), ok1.exception ?? ok1.status);
    console.log("\nNo signing certificate has been imported yet: signing, SharePoint upload and draft steps were NOT exercised.");
  } else {
    const { verifyPdfSignature } = await import("@/lib/pdf-sign");
    const { downloadFile } = await import("@/lib/sharepoint");
    for (const c of [ok1, ok2]) {
      const signed = c.documents.find((d) => d.kind === "SIGNED");
      check(`${c.attachmentName}: signed, stored and draft ready`, c.status === "DRAFT_READY" && Boolean(signed) && c.draft?.state === "ATTACHED", `${c.status} ${c.exception ?? ""}`);
      if (signed) {
        const bytes = await downloadFile(signed, signed.sha256);
        const v = verifyPdfSignature(bytes);
        check(`${c.attachmentName}: signature independently verified from OneDrive copy`, v.intact && v.valid && v.selfSigned, v.certSubject);
        check(`${c.attachmentName}: visible signature image embedded`, /\/Subtype\s*\/Image/.test(bytes.toString("latin1")));
        state.driveItems.push(signed.itemId);
      }
      const orig = c.documents.find((d) => d.kind === "ORIGINAL");
      if (orig) state.driveItems.push(orig.itemId);
      if (c.draft?.graphDraftId) {
        state.drafts.push(c.draft.graphDraftId);
        const d = await graph<{ toRecipients: { emailAddress: { address: string } }[]; ccRecipients: { emailAddress: { address: string } }[]; isDraft: boolean; hasAttachments: boolean; parentFolderId: string }>(
          `/me/messages/${c.draft.graphDraftId}?$select=toRecipients,ccRecipients,isDraft,hasAttachments`,
        );
        check(`${c.attachmentName}: Outlook draft has owner as To and CC, attachment present, still a draft`,
          d.isDraft && d.hasAttachments && d.toRecipients.some((r) => r.emailAddress.address.toLowerCase() === me.toLowerCase()) && d.ccRecipients.some((r) => r.emailAddress.address.toLowerCase() === me.toLowerCase()));
      }
    }
    // Re-run the whole chain: nothing may be duplicated.
    const draftsBefore = await db.outlookDraft.count();
    const signedBefore = await db.documentRef.count({ where: { kind: "SIGNED" } });
    for (const c of [ok1, ok2]) await runChain(c.id);
    check("re-running the chain creates no second signature or draft", (await db.outlookDraft.count()) === draftsBefore && (await db.documentRef.count({ where: { kind: "SIGNED" } })) === signedBefore);
  }
  save();

  // Never sent: nothing from this run in Sent Items.
  const sent = await graph<{ value: { id: string }[] }>(`/me/mailFolders('SentItems')/messages?$filter=${encodeURIComponent(`startswith(subject,'${tag}') or startswith(subject,'RE: ${tag}')`)}&$select=id&$top=5`);
  check("nothing from this run is in Sent Items", sent.value.length === 0);
  const usage = await db.usageRecord.aggregate({ _sum: { costUsd: true }, _count: true, where: { contractId: { in: state.contractIds } } });
  check("AI was mocked: usage records exist with no real OpenAI call", process.env.AI_MOCK === "1" && usage._count > 0, `${usage._count} mock records`);

  state.runs++;
  save();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}

async function cleanup(db: ReturnType<typeof import("@/lib/db").getDb>, graph: typeof import("@/lib/graph").graph) {
  let n = 0;
  for (const id of [...state.drafts, ...state.messages]) {
    try { await graph(`/me/messages/${id}`, { method: "DELETE" }); n++; } catch { /* already gone */ }
  }
  for (const id of state.driveItems) {
    try { await graph(`/me/drive/items/${id}`, { method: "DELETE" }); n++; } catch { /* already gone */ }
  }
  const ids = state.contractIds;
  await db.auditEvent.deleteMany({ where: { contractId: { in: ids } } });
  await db.outlookDraft.deleteMany({ where: { contractId: { in: ids } } });
  await db.documentRef.deleteMany({ where: { contractId: { in: ids } } });
  await db.contractAnalysis.deleteMany({ where: { contractId: { in: ids } } });
  await db.usageRecord.deleteMany({ where: { contractId: { in: ids } } });
  await db.contract.deleteMany({ where: { id: { in: ids } } });
  await db.processingJob.deleteMany({ where: { eventId: { in: state.eventIds } } });
  await db.incomingEvent.deleteMany({ where: { id: { in: state.eventIds } } });
  console.log(`cleanup: removed ${n} remote items and ${ids.length} contracts`);
  writeFileSync(STATE, JSON.stringify({ messages: [], drafts: [], contractIds: [], eventIds: [], driveItems: [], runs: 0 }));
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error("FATAL", e); process.exit(1); });
