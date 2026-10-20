import type { Prisma } from "@/generated/prisma/client";
import { readExtraction } from "./contract-schema";
import { getDb } from "./db";
import { parsePlacement, defaultPlacement } from "./placement";
import { ruleFor } from "./sender-rules";
import { getActiveSignatureImage } from "./signature-image";
import { GROUP_STATUSES, ownerMessage, primaryAction, statusView, timeline, runDuration, type Group } from "./view-model";

export const PAGE_SIZE = 25;

export type InboxFilter = "all" | Exclude<Group, "skipped">;
export const INBOX_FILTERS: InboxFilter[] = ["all", "attention", "processing", "draft", "failed"];
export const FILTER_LABEL: Record<InboxFilter, string> = { all: "All", attention: "Needs attention", processing: "Processing", draft: "Draft saved", failed: "Failed" };

export type Sort = "newest" | "oldest";

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseListParams(sp: Raw, filters: readonly string[]) {
  const f = one(sp.status);
  const page = Number.parseInt(one(sp.page), 10);
  return {
    status: (filters.includes(f) ? f : "all") as string,
    q: one(sp.q).trim().slice(0, 100),
    sort: (one(sp.sort) === "oldest" ? "oldest" : "newest") as Sort,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

const search = (q: string): Prisma.ContractWhereInput =>
  q ? { OR: (["attachmentName", "senderAddress", "senderName", "subject"] as const).map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) } : {};

const senderLabel = (c: { senderName: string | null; senderAddress: string | null }) => c.senderName || c.senderAddress || "Unknown sender";

async function counts(where: Prisma.ContractWhereInput) {
  const rows = await getDb().contract.groupBy({ by: ["status"], where, _count: true });
  const by = Object.fromEntries(rows.map((r) => [r.status, r._count]));
  const sum = (l: string[]) => l.reduce((n, s) => n + (by[s] ?? 0), 0);
  return {
    all: rows.reduce((n, r) => n + r._count, 0),
    attention: sum(GROUP_STATUSES.attention),
    processing: sum(GROUP_STATUSES.processing),
    draft: sum(GROUP_STATUSES.draft),
    failed: sum(GROUP_STATUSES.failed),
  };
}

export async function inbox(params: ReturnType<typeof parseListParams>) {
  const db = getDb();
  const base = search(params.q);
  const where: Prisma.ContractWhereInput = params.status === "all" ? base : { ...base, status: { in: GROUP_STATUSES[params.status as keyof typeof GROUP_STATUSES] } };
  const [total, rows, tally, needSignature] = await Promise.all([
    db.contract.count({ where }),
    db.contract.findMany({
      where,
      orderBy: [{ receivedAt: params.sort === "oldest" ? "asc" : "desc" }, { createdAt: params.sort === "oldest" ? "asc" : "desc" }],
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, attachmentName: true, senderAddress: true, senderName: true, subject: true, status: true, attention: true,
        exception: true, receivedAt: true, createdAt: true, updatedAt: true, graphMessageId: true,
      },
    }),
    counts(base),
    db.contract.count({ where: { status: "NEEDS_ATTENTION", attention: "SETUP" } }),
  ]);
  // Several PDFs in one email are separate records; the row says so.
  const siblings = await db.contract.groupBy({ by: ["graphMessageId"], where: { graphMessageId: { in: rows.map((r) => r.graphMessageId) } }, _count: true });
  const inEmail = Object.fromEntries(siblings.map((s) => [s.graphMessageId, s._count]));
  return {
    total,
    counts: tally,
    needSignature,
    rows: rows.map((r) => ({
      id: r.id,
      name: r.attachmentName,
      sender: senderLabel(r),
      senderAddress: r.senderAddress,
      subject: r.subject,
      status: statusView(r.status, r.attention),
      reason: r.status === "NEEDS_ATTENTION" || r.status === "FAILED" ? ownerMessage(r.status, r.attention, r.exception) : null,
      at: r.receivedAt ?? r.createdAt,
      inEmail: inEmail[r.graphMessageId] ?? 1,
    })),
  };
}

export const attentionCount = () => getDb().contract.count({ where: { status: "NEEDS_ATTENTION" } });
export const hasRunning = async () => (await getDb().contract.count({ where: { status: { in: GROUP_STATUSES.processing } } })) > 0;

export async function documentDetail(id: string) {
  const db = getDb();
  const c = await db.contract.findUnique({
    where: { id },
    include: {
      documents: { select: { kind: true } },
      draft: true,
      audits: { orderBy: { createdAt: "asc" }, select: { action: true, createdAt: true, actor: true, data: true } },
      analyses: { orderBy: { createdAt: "desc" }, take: 1, select: { result: true } },
    },
  });
  if (!c) return null;
  const hasSigned = c.documents.some((d) => d.kind === "SIGNED");
  const draft = c.draft ? { to: (c.draft.to as string[] | null) ?? [], cc: (c.draft.cc as string[] | null) ?? [] } : null;
  const steps = timeline({
    status: c.status, attention: c.attention, exception: ownerMessage(c.status, c.attention, c.exception), receivedAt: c.receivedAt ?? c.createdAt, hasSigned,
    senderLabel: senderLabel(c), pageCount: c.pageCount, audits: c.audits, draft,
  });
  const extraction = readExtraction(c.analyses[0]?.result);
  const [rule, image] = await Promise.all([ruleFor(c.senderAddress), getActiveSignatureImage()]);
  const hasImage = Boolean(image);
  const placement = parsePlacement(c.placement) ?? extraction?.locations[0] ?? null;
  // The PDFs of the same email, in attachment order, so the reading pane can step through them.
  const inEmail = await db.contract.findMany({ where: { graphMessageId: c.graphMessageId }, select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const position = inEmail.findIndex((x) => x.id === c.id);
  return {
    id: c.id,
    name: c.attachmentName,
    sender: senderLabel(c),
    senderAddress: c.senderAddress,
    subject: c.subject,
    receivedAt: c.receivedAt ?? c.createdAt,
    graphMessageId: c.graphMessageId,
    status: c.status,
    attention: c.attention,
    view: statusView(c.status, c.attention),
    exception: ownerMessage(c.status, c.attention, c.exception),
    pageCount: c.pageCount,
    hasSigned,
    hasSignatureImage: Boolean(image),
    placement,
    suggestedPlacement: placement ?? defaultPlacement(c.pageCount ?? 1),
    action: primaryAction({ status: c.status, attention: c.attention, hasSigned, updatedAt: c.updatedAt, hasDraft: Boolean(c.draft?.graphDraftId), hasImage }),
    steps,
    duration: runDuration(steps),
    draft,
    rule: rule ? { id: rule.id, sender: rule.sender, to: rule.to, cc: rule.cc, autoSign: rule.autoSign, remembered: Boolean(rule.placement) } : null,
    email: { index: position + 1, total: inEmail.length, previous: inEmail[position - 1]?.id ?? null, next: inEmail[position + 1]?.id ?? null },
  };
}
export type DocumentDetail = NonNullable<Awaited<ReturnType<typeof documentDetail>>>;

// ---- Activity -------------------------------------------------------------------------------------

export type ActivityFilter = "all" | "completed" | "processing" | "failed";
export const ACTIVITY_FILTERS: ActivityFilter[] = ["all", "completed", "processing", "failed"];
export const ACTIVITY_LABEL: Record<ActivityFilter, string> = { all: "All runs", completed: "Completed", processing: "Processing", failed: "Failed" };
const ACTIVITY_STATUSES: Record<Exclude<ActivityFilter, "all">, string[]> = {
  completed: ["DRAFT_SAVED"],
  processing: GROUP_STATUSES.processing,
  failed: ["FAILED"],
};

export async function activity(params: ReturnType<typeof parseListParams>) {
  const db = getDb();
  const base = search(params.q);
  const where: Prisma.ContractWhereInput = params.status === "all" ? base : { ...base, status: { in: ACTIVITY_STATUSES[params.status as Exclude<ActivityFilter, "all">] } };
  const [total, rows, image] = await Promise.all([
    db.contract.count({ where }),
    db.contract.findMany({
      where,
      orderBy: { updatedAt: params.sort === "oldest" ? "asc" : "desc" },
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        documents: { select: { kind: true } },
        draft: { select: { to: true, cc: true, graphDraftId: true } },
        audits: { orderBy: { createdAt: "asc" }, select: { action: true, createdAt: true, actor: true, data: true } },
      },
    }),
    getActiveSignatureImage(),
  ]);
  const hasImage = Boolean(image);
  return {
    total,
    rows: rows.map((c) => {
      const hasSigned = c.documents.some((d) => d.kind === "SIGNED");
      const draft = c.draft ? { to: (c.draft.to as string[] | null) ?? [], cc: (c.draft.cc as string[] | null) ?? [] } : null;
      const steps = timeline({
        status: c.status, attention: c.attention, exception: ownerMessage(c.status, c.attention, c.exception), receivedAt: c.receivedAt ?? c.createdAt, hasSigned,
        senderLabel: senderLabel(c), pageCount: c.pageCount, audits: c.audits, draft,
      });
      return {
        id: c.id,
        name: c.attachmentName,
        sender: senderLabel(c),
        status: statusView(c.status, c.attention),
        exception: ownerMessage(c.status, c.attention, c.exception),
        steps,
        duration: runDuration(steps),
        at: c.updatedAt,
        action: primaryAction({ status: c.status, attention: c.attention, hasSigned, updatedAt: c.updatedAt, hasDraft: Boolean(c.draft?.graphDraftId), hasImage }),
      };
    }),
  };
}
export type ActivityRow = Awaited<ReturnType<typeof activity>>["rows"][number];
