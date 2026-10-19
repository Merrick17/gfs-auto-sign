import OpenAI from "openai";
import { contractExtraction } from "./contract-schema";
import { getDb } from "./db";
import { graph, mailboxPath } from "./graph";
import { setStage } from "./pipeline";
import { policyRules } from "./policy";
import { downloadFile } from "./sharepoint";

// Extended property used to find our own draft again if a create call has an unknown outcome.
const MARKER_PROP = "String {7b3d9a52-4c1e-4f0a-9d63-5a1c2f7e8b10} Name GFSDraftMarker";
const BODY_TAG = "<!--gfs-reply-->";
type Msg = { id: string; body: { contentType: string; content: string }; parentFolderId?: string };
type Att = { id: string; name: string };

async function findMarkedDraft(marker: string): Promise<Msg | null> {
  const filter = `singleValueExtendedProperties/any(ep: ep/id eq '${MARKER_PROP}' and ep/value eq '${marker}')`;
  const r = await graph<{ value: Msg[] }>(
    `${mailboxPath()}/mailFolders('Drafts')/messages?$filter=${encodeURIComponent(filter)}&$select=id,body&$top=2`,
  );
  return r.value[0] ?? null;
}

async function writeBody(contract: { customer: string | null; contractNumber: string | null }, language: string | null, ownerNotes = "") {
  const ref = contract.contractNumber ? ` (${contract.contractNumber})` : "";
  const fallback = `Dear ${contract.customer ?? "Sir or Madam"},<br><br>Please find attached the signed sales contract${ref}.<br><br>Kind regards`;
  if (!process.env.OPENAI_API_KEY) return fallback;
  try {
    // Only trusted metadata goes to the model; no contract text.
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 2 });
    const r = await client.responses.create({
      model: process.env.OPENAI_MODEL_PRIMARY ?? "gpt-6-luna",
      store: false,
      instructions: "Write a concise, professional two-sentence email body in HTML (no signature block) confirming that the signed contract is attached. Use the requested language. Output only the HTML.",
      input: `Language: ${language ?? "English"}\nCustomer: ${contract.customer}\nContract reference: ${contract.contractNumber ?? "n/a"}${ownerNotes ? `\nNotes from the owner for this customer (trusted): ${ownerNotes}` : ""}`,
    });
    return r.output_text.trim() || fallback;
  } catch {
    return fallback;
  }
}

// Idempotent: safe to re-run after any partial failure.
export async function createReplyDraft(contractId: string) {
  const db = getDb();
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { documents: true } });
  const signed = c.documents.find((d) => d.kind === "SIGNED");
  if (!signed) throw new Error("no signed document");
  await setStage(contractId, "CREATING_DRAFT");

  const marker = `GFS-${contractId}`;
  let rec = await db.outlookDraft.upsert({
    where: { contractId },
    create: { contractId, marker },
    update: {},
  });
  if (rec.state === "ATTACHED") return { draftId: rec.graphDraftId, already: true };

  const analysis = await db.contractAnalysis.findFirstOrThrow({ where: { contractId }, orderBy: { createdAt: "desc" } });
  const extracted = contractExtraction.parse(analysis.result);
  // Recipients come from the policy version that approved this contract, not whatever is active now.
  const policy =
    (analysis.policyVersion !== null ? await db.signingPolicy.findUnique({ where: { version: analysis.policyVersion } }) : null) ??
    (await db.signingPolicy.findFirst({ where: { active: true }, orderBy: { version: "desc" } }));
  const rules = policy ? policyRules.parse(policy.rules) : null;
  const sameName = (r: { name: string }) => r.name.toLowerCase().trim() === (c.customer ?? "").toLowerCase().trim();
  const rule = (analysis.ruleId ? rules?.customers.find((r) => r.ruleId === analysis.ruleId) : undefined) ?? rules?.customers.find(sameName);
  const to = rule?.replyTo.length ? rule.replyTo : null;
  const cc = rule?.cc ?? [];

  // Resolve an ambiguous earlier attempt before creating anything new.
  let draft: Msg | null = rec.graphDraftId
    ? await graph<Msg>(`${mailboxPath()}/messages/${rec.graphDraftId}?$select=id,body`)
    : await findMarkedDraft(marker);

  if (!draft) {
    const base = `${mailboxPath()}/messages/${encodeURIComponent(c.graphMessageId)}`;
    draft = await graph<Msg>(`${base}/createReply`, {
      method: "POST",
      body: { message: { singleValueExtendedProperties: [{ id: MARKER_PROP, value: marker }] } },
    });
  }
  // Persist the id immediately so a later crash cannot orphan the draft.
  await db.outlookDraft.update({ where: { contractId }, data: { graphDraftId: draft.id } });

  // Recipients and body are written once; a crash after creating but before this point is repaired here.
  if (rec.state === "CREATING" && !draft.body?.content.includes(BODY_TAG)) {
    const html = await writeBody(c, extracted.language, rule?.instructions ?? "");
    await graph(`${mailboxPath()}/messages/${draft.id}`, {
      method: "PATCH",
      body: {
        body: { contentType: "html", content: `${BODY_TAG}${html}<br><br>${draft.body?.content ?? ""}` },
        ...(to ? { toRecipients: to.map((x) => ({ emailAddress: { address: x } })) } : {}),
        ccRecipients: cc.map((x) => ({ emailAddress: { address: x } })),
      },
    });
  }
  rec = await db.outlookDraft.update({
    where: { contractId },
    data: { state: "CREATED", to: to ?? undefined, cc },
  });

  const atts = await graph<{ value: Att[] }>(`${mailboxPath()}/messages/${draft.id}/attachments?$select=id,name`);
  const name = `signed-${c.attachmentName}`;
  if (!atts.value.some((a) => a.name === name)) {
    const bytes = await downloadFile(signed, signed.sha256);
    if (bytes.length > 3 * 1024 * 1024) {
      const { uploadUrl } = await graph<{ uploadUrl: string }>(`${mailboxPath()}/messages/${draft.id}/attachments/createUploadSession`, {
        method: "POST",
        body: { AttachmentItem: { attachmentType: "file", name, size: bytes.length, contentType: "application/pdf" } },
      });
      const CHUNK = 4 * 1024 * 1024;
      for (let s = 0; s < bytes.length; s += CHUNK) {
        const e = Math.min(s + CHUNK, bytes.length);
        const res = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Range": `bytes ${s}-${e - 1}/${bytes.length}`, "Content-Type": "application/octet-stream" },
          body: new Uint8Array(bytes.subarray(s, e)),
        });
        if (!res.ok) throw new Error(`attachment chunk failed: ${res.status}`);
      }
    } else {
      await graph(`${mailboxPath()}/messages/${draft.id}/attachments`, {
        method: "POST",
        body: { "@odata.type": "#microsoft.graph.fileAttachment", name, contentType: "application/pdf", contentBytes: bytes.toString("base64") },
      });
    }
  }

  await db.outlookDraft.update({ where: { contractId }, data: { state: "ATTACHED", attachmentOk: true } });
  await db.contract.update({ where: { id: contractId }, data: { status: "DRAFT_READY" } });
  await setStage(contractId, "COMPLETED");
  return { draftId: draft.id };
}
