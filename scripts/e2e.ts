// End-to-end run of the four steps against the real mailbox and OneDrive of the signed-in owner, and the
// database in DATABASE_URL. The AI is mocked (AI_MOCK=1). Nothing is ever sent: the Graph client refuses send endpoints.
//   npx tsx scripts/e2e.ts            run all scenarios (test data stays for review in the UI)
//   npx tsx scripts/e2e.ts cleanup    delete every test message, draft, OneDrive file, rule and row it created,
//                                     and put back the owner's own signature and signing settings
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { PDFDocument, StandardFonts } from "pdf-lib";

config({ path: ".env.local", quiet: true });
process.env.AI_MOCK = "1";
process.env.SHAREPOINT_ROOT_FOLDER ||= "GFS Contract Agent (TEST)";

const STATE = "secrets/e2e-state.json";
type State = {
  messages: string[]; drafts: string[]; contractIds: string[]; eventIds: string[]; driveItems: string[];
  ruleIds: string[]; imageIds: string[];
  restore: { imageId: string | null; signing: unknown; draft: unknown } | null;
};
const EMPTY: State = { messages: [], drafts: [], contractIds: [], eventIds: [], driveItems: [], ruleIds: [], imageIds: [], restore: null };
const state: State = { ...EMPTY, ...(existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {}) };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1));

const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function main() {
  const { getDb } = await import("@/lib/db");
  const { graph, SendBlocked } = await import("@/lib/graph");
  const { accessToken } = await import("@/lib/graph-token");
  const db = getDb();
  const me = process.env.MAILBOX_ID?.toLowerCase();
  if (!me) throw new Error("MAILBOX_ID must be set to the signed-in owner's address");
  const tag = `[GFS TEST ${Date.now().toString(36)}]`;

  if (process.argv[2] === "cleanup") return cleanup(db, graph);

  // ---- setup through the same services the Settings page uses ---------------------------------
  const { saveSignatureImage } = await import("@/lib/signature-image");
  const { saveRule } = await import("@/lib/sender-rules");
  const { setAutoSign } = await import("@/lib/settings");
  const { makePng } = await import("@/lib/test-png");
  if (!state.restore) {
    state.restore = {
      imageId: (await db.signatureImage.findFirst({ where: { active: true } }))?.id ?? null,
      signing: (await db.appSetting.findUnique({ where: { key: "signing" } }))?.value ?? null,
      draft: (await db.appSetting.findUnique({ where: { key: "draft" } }))?.value ?? null,
    };
    save();
    const image = await saveSignatureImage(makePng(400, 120), "gfs-test-signature.png");
    state.imageIds.push(image.id);
    state.driveItems.push(image.itemId);
    // Test mail comes from the owner's own address, so the rule is for that address.
    const rule = await saveRule({ sender: me, to: [], cc: [me], autoSign: true }, "e2e");
    state.ruleIds.push(rule.id);
    save();
  }
  await setAutoSign(true, "e2e");

  // ---- test material --------------------------------------------------------------------------
  const docPdf = async (name: string) => {
    const d = await PDFDocument.create();
    const p = d.addPage([595, 842]);
    const f = await d.embedFont(StandardFonts.Helvetica);
    p.drawText("AGREEMENT (TEST DOCUMENT)", { x: 50, y: 780, size: 16, font: f });
    p.drawText(`File: ${name}`, { x: 50, y: 750, size: 11, font: f });
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
  const pdf = (n: string) => docPdf(n).then((body) => ({ name: n, type: "application/pdf", body }));

  const { processEmailEvent } = await import("@/lib/intake");
  const { processDocument } = await import("@/lib/processing");
  const { createReplyDraft } = await import("@/lib/drafts");
  const { approveAndSign } = await import("@/lib/owner-actions");
  const { messageDedupeKey } = await import("@/lib/graph-notifications");
  const mailbox = await db.mailboxConnection.upsert({ where: { mailboxId: me }, create: { mailboxId: me, tenantId: process.env.AZURE_TENANT_ID ?? "t" }, update: {} });

  // Step 1 for one email, then steps 2 to 4 for each document, in-process (the same functions the tasks call).
  const ingest = async (label: string, graphMessageId: string) => {
    const ev = await db.incomingEvent.create({
      data: { mailboxId: mailbox.id, dedupeKey: messageDedupeKey(mailbox.id, graphMessageId), kind: "message.created", graphMessageId, subscriptionId: "e2e", payload: { source: "e2e" } },
    });
    state.eventIds.push(ev.id);
    const queued: string[] = [];
    const r = (await processEmailEvent(ev.id, async (cid) => void queued.push(cid), { allowDraft: true })) as { contracts?: string[] };
    state.contractIds.push(...(r.contracts ?? []));
    save();
    const again = await processEmailEvent(ev.id, async () => void queued.push("DUPLICATE"), { allowDraft: true });
    check(`replayed notification is a no-op (${label})`, JSON.stringify(again).includes("already processed"));
    for (const id of queued) {
      try {
        await processDocument(id, () => createReplyDraft(id));
      } catch (e) {
        console.log("  run error:", id, (e as Error).message);
      }
    }
    return queued;
  };

  const plain = await ingest("plain", await createMail(`${tag} ordinary email`, []));
  check("an email without attachments creates no document", plain.length === 0);
  const multi = await ingest("multi", await createMail(`${tag} two agreements and noise`, [
    await pdf("SC-OK1.pdf"), await pdf("SC-OK2.pdf"), await pdf("NOSIGN.pdf"),
    { name: "photo.jpg", type: "image/jpeg", body: Buffer.from("jpg") },
    { name: "fake.pdf", type: "application/pdf", body: Buffer.from("this is not a pdf") },
  ]));
  check("three real PDFs become documents; the jpg and the fake .pdf don't", multi.length === 3, `got ${multi.length}`);
  const risky = await ingest("risky", await createMail(`${tag} documents that must wait`, [await pdf("SC-INJECTION.pdf"), await pdf("SC-NOSPOT.pdf"), await pdf("SC-UNSURE.pdf")]));

  const docs = async () => db.contract.findMany({ where: { id: { in: [...multi, ...risky] } }, include: { draft: true, documents: true } });
  let all = await docs();
  const by = (n: string) => all.find((c) => c.attachmentName === n)!;

  const { downloadFile } = await import("@/lib/sharepoint");
  const verifyDraft = async (name: string) => {
    const c = by(name);
    const signed = c.documents.find((d) => d.kind === "SIGNED");
    check(`${name}: signed and draft saved`, c.status === "DRAFT_SAVED" && Boolean(signed) && c.draft?.state === "ATTACHED", `${c.status} ${c.exception ?? ""}`);
    if (signed) {
      const bytes = await downloadFile(signed, signed.sha256);
      check(`${name}: signed copy in OneDrive carries the signature image`, /\/Subtype\s*\/Image/.test(bytes.toString("latin1")));
      check(`${name}: no certificate signature is claimed`, !/\/ByteRange/.test(bytes.toString("latin1")));
      state.driveItems.push(signed.itemId);
    }
    for (const d of c.documents) if (d.kind === "ORIGINAL") state.driveItems.push(d.itemId);
    if (c.draft?.graphDraftId) {
      state.drafts.push(c.draft.graphDraftId);
      const d = await graph<{ ccRecipients: { emailAddress: { address: string } }[]; isDraft: boolean; webLink?: string }>(`/me/messages/${c.draft.graphDraftId}?$select=ccRecipients,isDraft,webLink`);
      const atts = await graph<{ value: { name: string }[] }>(`/me/messages/${c.draft.graphDraftId}/attachments?$select=name`);
      check(`${name}: Outlook draft has the sender rule's CC, one signed attachment, and is still a draft`,
        d.isDraft && d.ccRecipients.some((r) => r.emailAddress.address.toLowerCase() === me) && atts.value.filter((a) => a.name.includes("(signed)")).length === 1);
      check(`${name}: draft link opens Outlook`, Boolean(c.draft.webLink ?? d.webLink));
    }
  };
  await verifyDraft("SC-OK1.pdf");
  await verifyDraft("SC-OK2.pdf");

  check("NOSIGN.pdf is skipped, not signed", by("NOSIGN.pdf").status === "SKIPPED" && !by("NOSIGN.pdf").documents.some((d) => d.kind === "SIGNED"));
  check("a document with text addressed to the assistant waits for review", by("SC-INJECTION.pdf").status === "NEEDS_ATTENTION" && by("SC-INJECTION.pdf").attention === "REVIEW");
  check("a document without a signature position waits for placement", by("SC-NOSPOT.pdf").attention === "PLACEMENT");
  check("an uncertain signature position waits for confirmation", by("SC-UNSURE.pdf").attention === "PLACEMENT");
  check("none of the waiting documents has a signed copy", ["SC-INJECTION.pdf", "SC-NOSPOT.pdf", "SC-UNSURE.pdf"].every((n) => !by(n).documents.some((d) => d.kind === "SIGNED")));

  // The owner places the signature by hand.
  const r = await approveAndSign(by("SC-NOSPOT.pdf").id, { page: 1, x: 0.12, y: 0.82, width: 0.3, height: 0.08 }, { remember: false, actor: "e2e" });
  all = await docs();
  check("owner placement signs and saves the draft", r.ok && by("SC-NOSPOT.pdf").status === "DRAFT_SAVED", r.message);
  await verifyDraft("SC-NOSPOT.pdf");

  // Running everything again must not duplicate anything.
  const draftsBefore = await db.outlookDraft.count();
  const signedBefore = await db.documentRef.count({ where: { kind: "SIGNED" } });
  for (const c of [by("SC-OK1.pdf"), by("SC-OK2.pdf"), by("SC-NOSPOT.pdf")]) {
    await processDocument(c.id, () => createReplyDraft(c.id));
    await createReplyDraft(c.id);
  }
  const twice = await approveAndSign(by("SC-NOSPOT.pdf").id, { page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.08 }, { remember: false, actor: "e2e" });
  check("re-running creates no second signature or draft", (await db.outlookDraft.count()) === draftsBefore && (await db.documentRef.count({ where: { kind: "SIGNED" } })) === signedBefore && twice.ok);

  // Without the owner's standing authorization nothing is signed automatically.
  await setAutoSign(false, "e2e");
  const off = await ingest("auto-sign off", await createMail(`${tag} automatic signing off`, [await pdf("SC-OK3.pdf")]));
  const ok3 = await db.contract.findUniqueOrThrow({ where: { id: off[0] }, include: { documents: true } });
  check("with automatic signing off, a certain position still waits for approval", ok3.attention === "APPROVAL" && !ok3.documents.some((d) => d.kind === "SIGNED"));
  for (const d of ok3.documents) state.driveItems.push(d.itemId);

  await graph("/me/sendMail", { method: "POST", body: {} }).then(
    () => check("the Graph client refuses to send mail", false),
    (e) => check("the Graph client refuses to send mail", e instanceof SendBlocked),
  );
  const sent = await graph<{ value: { id: string }[] }>(`/me/mailFolders('SentItems')/messages?$filter=${encodeURIComponent(`startswith(subject,'${tag}') or startswith(subject,'RE: ${tag}')`)}&$select=id&$top=5`);
  check("nothing from this run is in Sent Items", sent.value.length === 0);

  save();
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}

async function cleanup(db: ReturnType<typeof import("@/lib/db").getDb>, graph: typeof import("@/lib/graph").graph) {
  let n = 0;
  if (state.restore) {
    const put = async (key: string, value: unknown) =>
      value === null ? db.appSetting.deleteMany({ where: { key } }) : db.appSetting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
    await put("signing", state.restore.signing);
    await put("draft", state.restore.draft);
    await db.senderRule.deleteMany({ where: { id: { in: state.ruleIds } } });
    await db.signatureImage.deleteMany({ where: { id: { in: state.imageIds } } });
    if (state.restore.imageId && !(await db.signatureImage.findFirst({ where: { active: true } })))
      await db.signatureImage.updateMany({ where: { id: state.restore.imageId, removedAt: null }, data: { active: true } });
  }
  for (const id of [...state.drafts, ...state.messages]) {
    try { await graph(`/me/messages/${id}`, { method: "DELETE" }); n++; } catch { /* already gone */ }
  }
  for (const id of new Set(state.driveItems)) {
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
  console.log(`cleanup: removed ${n} remote items and ${ids.length} documents`);
  writeFileSync(STATE, JSON.stringify(EMPTY));
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error("FATAL", e); process.exit(1); });
