// Pure presentation rules shared by Inbox, document page and Activity. No database or framework imports.

export type Tone = "neutral" | "running" | "success" | "warning" | "danger" | "muted";
export type Group = "attention" | "processing" | "draft" | "failed" | "skipped";

export type StatusView = { label: string; tone: Tone; group: Group };

const STALL_MS = 3 * 60_000;

export function statusView(status: string, attention: string | null): StatusView {
  switch (status) {
    case "NEEDS_ATTENTION":
      if (attention === "PLACEMENT") return { label: "Add signature", tone: "warning", group: "attention" };
      if (attention === "SETUP") return { label: "Signature missing", tone: "warning", group: "attention" };
      if (attention === "REVIEW") return { label: "Needs review", tone: "warning", group: "attention" };
      return { label: "Needs approval", tone: "warning", group: "attention" };
    case "SIGNING":
      return { label: "Signing", tone: "running", group: "processing" };
    case "SIGNED":
    case "DRAFTING":
      return { label: "Saving draft", tone: "running", group: "processing" };
    case "DRAFT_SAVED":
      return { label: "Draft saved", tone: "success", group: "draft" };
    case "FAILED":
      return { label: "Failed", tone: "danger", group: "failed" };
    case "SKIPPED":
      return { label: "Skipped", tone: "muted", group: "skipped" };
    default:
      return { label: "Reading", tone: "running", group: "processing" };
  }
}

export const GROUP_STATUSES: Record<Exclude<Group, "skipped">, string[]> = {
  attention: ["NEEDS_ATTENTION"],
  processing: ["RECEIVED", "SIGNING", "SIGNED", "DRAFTING"],
  draft: ["DRAFT_SAVED"],
  failed: ["FAILED"],
};

export type PrimaryAction = "place" | "approve" | "settings" | "save-draft" | "open-outlook" | "retry" | null;

// One action per state, matching what the document actually needs next.
export function primaryAction(c: { status: string; attention: string | null; hasSigned: boolean; updatedAt: Date; hasDraft: boolean; hasImage?: boolean }, now = Date.now()): PrimaryAction {
  if (c.status === "NEEDS_ATTENTION") {
    // Signing needs the image first, whatever else the document is waiting for.
    if (c.attention === "SETUP" || c.hasImage === false) return "settings";
    return c.attention === "PLACEMENT" ? "place" : "approve";
  }
  if (c.status === "DRAFT_SAVED") return c.hasDraft ? "open-outlook" : null;
  if (c.status === "FAILED") return c.hasSigned ? "save-draft" : "retry";
  // A signed copy whose draft step never started (or stopped) can be finished by hand.
  if ((c.status === "SIGNED" || c.status === "DRAFTING") && now - c.updatedAt.getTime() > STALL_MS) return "save-draft";
  if (c.status === "SKIPPED") return c.hasImage === false ? null : "place";
  return null;
}

export const ACTION_LABEL: Record<Exclude<PrimaryAction, null>, string> = {
  place: "Add signature",
  approve: "Review & approve",
  settings: "Add signature image",
  "save-draft": "Save Outlook draft",
  "open-outlook": "Open in Outlook",
  retry: "Retry",
};

// ---- Execution timeline ------------------------------------------------------------------------

export type StepKey = "received" | "ingested" | "signed" | "draft";
export type StepState = "done" | "running" | "attention" | "failed" | "skipped" | "pending";
export type Step = { key: StepKey; title: string; state: StepState; at: Date | null; detail: string | null };

export const STEP_TITLE: Record<StepKey, string> = {
  received: "Email received",
  ingested: "Document ingested",
  signed: "Signature added",
  draft: "Outlook draft saved",
};

const ORDER: StepKey[] = ["received", "ingested", "signed", "draft"];

// Earlier versions recorded stages under other names; they still show up in the right step.
const EVENT_STEP: Record<string, StepKey> = {
  received: "received",
  "stage:EMAIL_RECEIVED": "received",
  ingested: "ingested",
  "analysis:complete": "ingested",
  signed: "signed",
  "draft-saved": "draft",
  "stage:COMPLETED": "draft",
};

export type TimelineInput = {
  status: string;
  attention: string | null;
  exception: string | null;
  receivedAt: Date;
  hasSigned: boolean;
  senderLabel: string;
  pageCount: number | null;
  audits: { action: string; createdAt: Date; actor: string; data: unknown }[];
  draft: { to: string[]; cc: string[] } | null;
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function timeline(i: TimelineInput): Step[] {
  const at: Partial<Record<StepKey, { at: Date; data: unknown; actor: string }>> = {};
  for (const a of i.audits) {
    const k = EVENT_STEP[a.action];
    if (k) at[k] = { at: a.createdAt, data: a.data, actor: a.actor };
  }
  const done: Record<StepKey, boolean> = {
    received: true,
    ingested: Boolean(at.ingested) || !["RECEIVED", "FAILED"].includes(i.status) || i.hasSigned,
    signed: i.hasSigned,
    draft: i.status === "DRAFT_SAVED",
  };
  const current = ORDER.find((k) => !done[k]) ?? null;
  const currentState: StepState =
    i.status === "FAILED" ? "failed"
    : i.status === "NEEDS_ATTENTION" ? "attention"
    : i.status === "SKIPPED" ? "skipped"
    : "running";

  return ORDER.map((key) => {
    const ev = at[key];
    let detail: string | null = null;
    if (key === "received") detail = `From ${i.senderLabel}`;
    if (key === "ingested") {
      const d = ev?.data as { pages?: number; read?: boolean } | undefined;
      const pages = d?.pages ?? i.pageCount;
      detail = pages ? plural(pages, "page") : null;
    }
    if (key === "signed" && ev) {
      const by = (ev.data as { by?: string } | null)?.by;
      detail = by === "owner" ? "Approved by you" : by === "auto" ? "Signed automatically" : "Signature image added";
    }
    if (key === "draft" && i.draft) detail = [`To ${i.draft.to.join(", ") || "the sender"}`, i.draft.cc.length ? `CC ${i.draft.cc.join(", ")}` : null].filter(Boolean).join(" · ");

    if (done[key]) return { key, title: STEP_TITLE[key], state: "done", at: ev?.at ?? (key === "received" ? i.receivedAt : null), detail };
    if (key === current) return { key, title: STEP_TITLE[key], state: currentState, at: null, detail: currentState === "running" ? null : i.exception };
    return { key, title: STEP_TITLE[key], state: "pending", at: null, detail: null };
  });
}

export function runDuration(steps: Step[]): number | null {
  const first = steps[0]?.at;
  const last = steps[3];
  return first && last?.state === "done" && last.at ? Math.max(0, last.at.getTime() - first.getTime()) : null;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return "<1 sec";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

// Records from the earlier version may carry technical reasons (policy and certificate checks) or none at all.
// Those are shown as the one sentence that matches what the owner can do now.
const FALLBACK_REASON: Record<string, string> = {
  APPROVAL: "Check the signature position and approve.",
  PLACEMENT: "Choose where your signature goes.",
  REVIEW: "Check this document before signing.",
  SETUP: "Add your signature image in Settings to sign this document.",
};

export function ownerMessage(status: string, attention: string | null, exception: string | null): string | null {
  if (status !== "NEEDS_ATTENTION") return exception;
  const legacy = !exception || exception.includes("|") || /certificate|authori[sz]ation|policy|runtime/i.test(exception);
  return legacy ? (FALLBACK_REASON[attention ?? "APPROVAL"] ?? FALLBACK_REASON.APPROVAL) : exception;
}
