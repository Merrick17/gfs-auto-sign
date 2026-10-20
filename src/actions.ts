"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireOwner, signIn } from "@/auth";
import { getDb } from "@/lib/db";
import { GraphError, graph } from "@/lib/graph";
import { AuthRequired } from "@/lib/graph-token";
import { checkMail } from "@/lib/check-mail";
import { listDocuments, parseListQuery } from "@/lib/mailbox-view";
import { approveAndSign, approveSuggested, retry, saveDraft, skip } from "@/lib/owner-actions";
import { placementSchema } from "@/lib/placement";
import { deleteRule, isEmail, ruleInput, saveRule } from "@/lib/sender-rules";
import { setAutoSign, setDraftSettings } from "@/lib/settings";
import { SignatureImageError, removeSignatureImage, saveSignatureImage } from "@/lib/signature-image";
import { originalParticipants, suggestRecipients, suggestSenders, type Suggestion } from "@/lib/suggestions";

// Server actions can be called with anything a browser sends, so every argument is checked here.

export type Result = { ok: boolean; message: string };

const ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const MAX_SIGNATURE_UPLOAD = 1_500_000;

const actor = async () => (await requireOwner()).user?.email ?? "owner";

function fail(e: unknown, fallback: string): Result {
  if (e instanceof SignatureImageError) return { ok: false, message: e.message };
  if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? fallback };
  if (e instanceof AuthRequired) return { ok: false, message: "Your Microsoft 365 sign-in expired. Reconnect in Settings." };
  if (e instanceof GraphError && (e.status === 401 || e.status === 403)) return { ok: false, message: "Microsoft 365 didn't allow that. Reconnect in Settings and accept the requested access." };
  return { ok: false, message: fallback };
}

async function run(fallback: string, fn: (who: string) => Promise<Result>): Promise<Result> {
  try {
    const r = await fn(await actor());
    refresh();
    return r;
  } catch (e) {
    return fail(e, fallback);
  }
}

// ---- Documents ---------------------------------------------------------------------------------

export async function approveAction(id: unknown, placement: unknown, remember: unknown): Promise<Result> {
  return run("The signature couldn't be added. Please try again.", async (who) =>
    approveAndSign(ID.parse(id), placementSchema.parse(placement), { remember: z.boolean().parse(remember), actor: who }),
  );
}

// One document of a bulk approval. The browser calls this once per selected document so a long batch never hits a request time limit.
export async function approveSuggestedAction(id: unknown): Promise<Result> {
  return run("The signature couldn't be added. Please try again.", (who) => approveSuggested(ID.parse(id), who));
}

export async function saveDraftAction(id: unknown): Promise<Result> {
  return run("The draft couldn't be saved. Please try again.", (who) => saveDraft(ID.parse(id), who));
}

export async function retryAction(id: unknown): Promise<Result> {
  return run("Retry didn't start. Please try again.", (who) => retry(ID.parse(id), who));
}

export async function skipAction(id: unknown): Promise<Result> {
  return run("The document couldn't be skipped.", (who) => skip(ID.parse(id), who));
}

// ---- Suggestions (live from the mailbox) ----------------------------------------------------------

const query = z.string().max(100).catch("");

export async function suggestSendersAction(q: unknown): Promise<Suggestion[]> {
  try {
    await requireOwner();
    return await suggestSenders(query.parse(q));
  } catch {
    return [];
  }
}

export async function suggestRecipientsAction(input: unknown): Promise<Suggestion[]> {
  try {
    await requireOwner();
    const i = z
      .object({ sender: z.string().max(254).optional(), query: query.optional(), role: z.enum(["to", "cc"]), exclude: z.array(z.string().max(254)).max(100).optional() })
      .parse(input);
    return await suggestRecipients(i);
  } catch {
    return [];
  }
}

export async function originalParticipantsAction(id: unknown) {
  try {
    await requireOwner();
    const c = await getDb().contract.findUnique({ where: { id: ID.parse(id) }, select: { graphMessageId: true } });
    return c ? await originalParticipants(c.graphMessageId) : null;
  } catch {
    return null;
  }
}

// ---- Sender rules ------------------------------------------------------------------------------------

export async function saveRuleAction(input: unknown, id?: unknown): Promise<Result> {
  return run("The rule couldn't be saved.", async (who) => {
    const parsed = ruleInput.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the rule." };
    const existing = await getDb().senderRule.findUnique({ where: { sender: parsed.data.sender } });
    const ruleId = id === undefined ? undefined : ID.parse(id);
    if (existing && existing.id !== ruleId) return { ok: false, message: `There is already a rule for ${parsed.data.sender}.` };
    await saveRule(parsed.data, who, ruleId);
    return { ok: true, message: `Rule for ${parsed.data.sender} saved.` };
  });
}

export async function deleteRuleAction(id: unknown): Promise<Result> {
  return run("The rule couldn't be removed.", async (who) => {
    await deleteRule(ID.parse(id), who);
    return { ok: true, message: "Rule removed." };
  });
}

// ---- Signature -------------------------------------------------------------------------------------

export async function uploadSignatureAction(form: FormData): Promise<Result> {
  return run("Your signature couldn't be saved to OneDrive. Check the connection and try again.", async () => {
    const file = form.get("image");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose an image first." };
    if (file.size > MAX_SIGNATURE_UPLOAD) return { ok: false, message: "That image is too large. Please use one under 1.5 MB." };
    await saveSignatureImage(Buffer.from(await file.arrayBuffer()), file.name);
    return { ok: true, message: "Signature saved to your OneDrive." };
  });
}

export async function removeSignatureAction(): Promise<Result> {
  return run("Your signature couldn't be removed.", async () => {
    await removeSignatureImage();
    return { ok: true, message: "Signature removed. Documents will wait for you until you add one." };
  });
}

// ---- Preferences -------------------------------------------------------------------------------------

export async function setAutoSignAction(on: unknown, consent: unknown): Promise<Result> {
  return run("Automatic signing couldn't be changed.", async (who) => {
    const enable = z.boolean().parse(on);
    if (enable && consent !== true) return { ok: false, message: "Confirm the authorization to turn on automatic signing." };
    await setAutoSign(enable, who);
    return { ok: true, message: enable ? "Automatic signing is on for the senders you allow." : "Automatic signing is off. Every document waits for your approval." };
  });
}

export async function saveDraftSettingsAction(input: unknown): Promise<Result> {
  return run("Draft preferences couldn't be saved.", async (who) => {
    const i = z
      .object({
        message: z.string().max(4000, "The message can be up to 4,000 characters."),
        cc: z.array(z.string().trim().toLowerCase()).max(50).refine((l) => l.every(isEmail), "One of the CC addresses isn't valid."),
      })
      .parse(input);
    await setDraftSettings({ message: i.message, cc: [...new Set(i.cc)] }, who);
    return { ok: true, message: "Draft preferences saved." };
  });
}

// ---- Microsoft 365 ----------------------------------------------------------------------------------

export async function reconnectAction() {
  await requireOwner();
  await signIn("microsoft-entra-id", { redirectTo: "/settings?connected=1" });
}

// Stops watching the inbox and forgets the stored sign-in. Documents and files already saved stay.
export async function disconnectAction(): Promise<Result> {
  return run("Microsoft 365 couldn't be disconnected.", async (who) => {
    const db = getDb();
    const subs = await db.graphSubscription.findMany({ where: { status: "active" } });
    for (const s of subs) await graph(`/subscriptions/${s.graphId}`, { method: "DELETE" }).catch(() => undefined);
    await db.graphSubscription.updateMany({ where: { status: "active" }, data: { status: "removed" } });
    await db.oAuthConnection.deleteMany({});
    await db.auditEvent.create({ data: { actor: who, action: "microsoft:disconnected" } });
    return { ok: true, message: "Microsoft 365 disconnected. New email isn't processed until you reconnect." };
  });
}

// ---- Mailbox view ------------------------------------------------------------------------------------

// The document list beside the reading pane. It is read from the client so the list keeps its place and scroll
// position while documents open in the pane.
export async function listDocumentsAction(input: unknown) {
  await requireOwner();
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return listDocuments(parseListQuery(i));
}

// Looks at the last two weeks of the inbox for emails with attachments that haven't arrived through a notification.
export async function checkMailAction(): Promise<Result & { documents?: number }> {
  try {
    await requireOwner();
    const r = await checkMail();
    refresh();
    if (r.documents > 0) return { ok: true, documents: r.documents, message: `${r.documents} new document${r.documents === 1 ? "" : "s"} from ${r.newEmails} email${r.newEmails === 1 ? "" : "s"}.` };
    return { ok: true, documents: 0, message: r.emails ? "No new documents. Everything in your inbox is already here." : "No emails with attachments in the last 14 days." };
  } catch (e) {
    return fail(e, "Your inbox couldn't be checked. Please try again.");
  }
}
