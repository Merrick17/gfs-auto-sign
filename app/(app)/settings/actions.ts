"use server";

import { revalidatePath } from "next/cache";
import { signIn, requireOwner } from "@/auth";
import { CertificateError, createSelfSigned, importP12 } from "@/lib/certificate";
import { searchContacts, searchPeople, syncContacts, type ContactSuggestion } from "@/lib/contacts";
import { getDb } from "@/lib/db";
import { GraphError } from "@/lib/graph";
import { AuthRequired, grantedScopes } from "@/lib/graph-token";
import { proposeRule, AssistUnavailable, type Proposal } from "@/lib/rule-assist";
import { ruleFormSchema, type RuleForm } from "@/lib/rule-schema";
import { NotReady, deleteRule, saveRule, setAutomaticSigning, setReviewKeywords, setRuleEnabled } from "@/lib/rules";
import { SignatureImageError, removeSignatureImage, saveSignatureImage } from "@/lib/signature-image";
import { saveSigner } from "@/lib/signer";
import { setAiEnabled, setSpendingLimit } from "@/lib/spending";
import { ensureSubscription } from "@/lib/subscriptions";

export type Result<T = object> = ({ ok: true; message: string } & T) | { ok: false; message: string };

const fail = (e: unknown, fallback: string): { ok: false; message: string } => {
  if (e instanceof SignatureImageError || e instanceof CertificateError || e instanceof NotReady || e instanceof AssistUnavailable) return { ok: false, message: e.message };
  if (e instanceof AuthRequired) return { ok: false, message: "Your Microsoft sign-in has expired. Reconnect on the Outlook & OneDrive tab." };
  if (e instanceof GraphError && e.status === 403) return { ok: false, message: "Microsoft didn't allow that. Reconnect and accept the requested access." };
  return { ok: false, message: fallback };
};

const actor = async () => (await requireOwner()).user?.email ?? "owner";

// ---- Outlook & OneDrive ------------------------------------------------------------------------
export async function connectMicrosoft() {
  await requireOwner().catch(() => null);
  await signIn("microsoft-entra-id", { redirectTo: "/settings?connected=1" });
}

export async function checkConnection(): Promise<Result> {
  try {
    await requireOwner();
    const r = await ensureSubscription();
    revalidatePath("/settings");
    return { ok: true, message: r === "not-public" ? "Signed in. Live monitoring starts once this app is published online." : "Outlook is being watched for new contracts." };
  } catch (e) {
    return fail(e, "We couldn't check the connection. Please try again.");
  }
}

// ---- My Signature ------------------------------------------------------------------------------
export async function uploadSignature(form: FormData): Promise<Result> {
  try {
    await requireOwner();
    const file = form.get("image");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose an image first." };
    const row = await saveSignatureImage(Buffer.from(await file.arrayBuffer()), file.name);
    revalidatePath("/settings");
    return { ok: true, message: `Signature saved to your OneDrive (version ${row.version}).` };
  } catch (e) {
    return fail(e, "We couldn't save your signature to OneDrive. Check the connection and try again.");
  }
}

export async function removeSignature(): Promise<Result> {
  try {
    await requireOwner();
    await removeSignatureImage();
    revalidatePath("/settings");
    return { ok: true, message: "Signature removed. Contracts will wait for your review until you add a new one." };
  } catch (e) {
    return fail(e, "We couldn't remove your signature. Please try again.");
  }
}

export async function createDigitalSignature(form: FormData): Promise<Result> {
  try {
    const session = await requireOwner();
    const name = String(form.get("name") ?? "").trim();
    const title = String(form.get("title") ?? "").trim();
    if (name.length < 2) return { ok: false, message: "Enter the name that should appear on signed contracts." };
    if (form.get("consent") !== "true") return { ok: false, message: "Please confirm that GFS may sign automatically on your behalf." };
    const { p12, info } = createSelfSigned({ name, email: session.user?.email ?? undefined, organization: "Green Fashion Solution FZCO" });
    await saveSigner({ name, title, p12, info, consent: true });
    revalidatePath("/settings");
    return { ok: true, message: "Your digital signature is ready." };
  } catch (e) {
    return fail(e, "We couldn't set up your digital signature. Please try again.");
  }
}

export async function importDigitalSignature(form: FormData): Promise<Result> {
  try {
    await requireOwner();
    const name = String(form.get("name") ?? "").trim();
    const title = String(form.get("title") ?? "").trim();
    const file = form.get("certificate");
    const password = String(form.get("password") ?? "");
    if (name.length < 2) return { ok: false, message: "Enter the name that should appear on signed contracts." };
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose your certificate file first." };
    if (file.size > 200_000) return { ok: false, message: "That file is too large to be a certificate." };
    if (form.get("consent") !== "true") return { ok: false, message: "Please confirm that GFS may sign automatically on your behalf." };
    const { p12, info } = importP12(Buffer.from(await file.arrayBuffer()), password);
    await saveSigner({ name, title, p12, info, consent: true });
    revalidatePath("/settings");
    return { ok: true, message: "Your certificate is ready to use." };
  } catch (e) {
    return fail(e, "We couldn't use that certificate. Please try again.");
  }
}

// ---- Automatic signing & recipients --------------------------------------------------------------
export async function saveRuleAction(values: RuleForm): Promise<Result<{ id: string }>> {
  try {
    const who = await actor();
    const parsed = ruleFormSchema.safeParse(values);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the highlighted fields." };
    const saved = await saveRule(parsed.data, who);
    revalidatePath("/settings");
    return { ok: true, message: "Rule saved.", id: saved.id! };
  } catch (e) {
    return fail(e, "We couldn't save this rule. Please try again.");
  }
}

export async function deleteRuleAction(id: string): Promise<Result> {
  try {
    await deleteRule(id, await actor());
    revalidatePath("/settings");
    return { ok: true, message: "Rule deleted." };
  } catch (e) {
    return fail(e, "We couldn't delete this rule.");
  }
}

export async function toggleRuleAction(id: string, enabled: boolean): Promise<Result> {
  try {
    await setRuleEnabled(id, enabled, await actor());
    revalidatePath("/settings");
    return { ok: true, message: enabled ? "Rule turned on." : "Rule turned off." };
  } catch (e) {
    return fail(e, "We couldn't change this rule.");
  }
}

export async function reviewKeywordsAction(words: string[]): Promise<Result> {
  try {
    await setReviewKeywords(words, await actor());
    revalidatePath("/settings");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return fail(e, "We couldn't save that.");
  }
}

export async function automaticSigningAction(on: boolean): Promise<Result> {
  try {
    await setAutomaticSigning(on, await actor());
    revalidatePath("/settings");
    return { ok: true, message: on ? "Automatic signing is on." : "Automatic signing is off." };
  } catch (e) {
    return fail(e, "We couldn't change automatic signing.");
  }
}

// ---- Contacts ----------------------------------------------------------------------------------------
export async function searchContactsAction(input: { query: string; customer?: string; exclude?: string[] }): Promise<ContactSuggestion[]> {
  await requireOwner();
  let hits = await searchContacts({ query: input.query, customer: input.customer, exclude: input.exclude });
  // The local index is searched first. Microsoft's people search fills gaps, but only if it was allowed.
  if (input.query.trim().length >= 2 && hits.length < 4) {
    try {
      if ((await grantedScopes()).some((s) => s.toLowerCase() === "people.read")) {
        await searchPeople(input.query.trim());
        hits = await searchContacts({ query: input.query, customer: input.customer, exclude: input.exclude });
      }
    } catch {
      // Directory search is a bonus; the index results still stand.
    }
  }
  return hits;
}

export async function syncContactsAction(): Promise<Result<{ contacts: number }>> {
  try {
    await requireOwner();
    await syncContacts();
    const contacts = await getDb().contact.count();
    revalidatePath("/settings");
    return { ok: true, message: contacts ? `Found ${contacts} people you've been in touch with.` : "No contacts found yet.", contacts };
  } catch (e) {
    return fail(e, "We couldn't read your contacts right now. Please try again.");
  }
}

export async function suggestRuleAction(text: string, customer?: string): Promise<Result<{ proposal: Proposal; people: { asked: string; matches: ContactSuggestion[] }[] }>> {
  try {
    await requireOwner();
    const r = await proposeRule(text, customer);
    return { ok: true, message: "Here's what I understood. Review it, then save.", ...r };
  } catch (e) {
    return fail(e, "AI help isn't available right now. You can fill in the rule by hand.");
  }
}

// ---- AI & spending ---------------------------------------------------------------------------------------
export async function spendingLimitAction(usd: number | null): Promise<Result> {
  try {
    await requireOwner();
    if (usd !== null && (!Number.isFinite(usd) || usd < 0 || usd > 100_000)) return { ok: false, message: "Enter an amount between 0 and 100,000." };
    await setSpendingLimit(usd);
    revalidatePath("/settings");
    return { ok: true, message: usd === null ? "Spending limit removed." : "Spending limit saved." };
  } catch (e) {
    return fail(e, "We couldn't save the limit.");
  }
}

export async function aiEnabledAction(on: boolean): Promise<Result> {
  try {
    await requireOwner();
    await setAiEnabled(on);
    revalidatePath("/settings");
    return { ok: true, message: on ? "AI processing is on." : "AI processing is paused. New contracts will wait for your review." };
  } catch (e) {
    return fail(e, "We couldn't change that.");
  }
}
