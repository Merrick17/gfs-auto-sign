import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "./db";
import { FOLDERS, LIST_PAGE_SIZE, type Folder, type ListQuery, type ListRow } from "./mailbox-folders";
import { parsePlacement } from "./placement";
import { GROUP_STATUSES, ownerMessage, statusView } from "./view-model";

export { FOLDER_LABEL, FOLDERS, LIST_PAGE_SIZE, type Folder, type ListQuery, type ListRow } from "./mailbox-folders";

// The mail-style views: folders in the sidebar, the document list beside the reading pane.

const STATUSES: Record<Exclude<Folder, "all">, string[]> = { ...GROUP_STATUSES, skipped: ["SKIPPED"] };

export function parseListQuery(input: { folder?: unknown; q?: unknown; page?: unknown; sort?: unknown }): ListQuery {
  const folder = (FOLDERS as readonly string[]).includes(String(input.folder)) ? (input.folder as Folder) : "all";
  const page = Number.parseInt(String(input.page ?? "1"), 10);
  return {
    folder,
    q: typeof input.q === "string" ? input.q.trim().slice(0, 100) : "",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 1000) : 1,
    sort: input.sort === "oldest" ? "oldest" : "newest",
  };
}

const search = (q: string): Prisma.ContractWhereInput =>
  q ? { OR: (["attachmentName", "senderAddress", "senderName", "subject"] as const).map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) } : {};

export async function folderCounts(): Promise<Record<Folder, number>> {
  const rows = await getDb().contract.groupBy({ by: ["status"], _count: true });
  const by = Object.fromEntries(rows.map((r) => [r.status, r._count]));
  const sum = (l: string[]) => l.reduce((n, s) => n + (by[s] ?? 0), 0);
  return {
    all: rows.reduce((n, r) => n + r._count, 0),
    attention: sum(STATUSES.attention),
    processing: sum(STATUSES.processing),
    draft: sum(STATUSES.draft),
    failed: sum(STATUSES.failed),
    skipped: sum(STATUSES.skipped),
  };
}


export async function listDocuments(query: ListQuery): Promise<{ rows: ListRow[]; total: number; processing: boolean }> {
  const db = getDb();
  const base = search(query.q);
  const where: Prisma.ContractWhereInput = query.folder === "all" ? base : { ...base, status: { in: STATUSES[query.folder] } };
  const dir = query.sort === "oldest" ? "asc" : "desc";
  const [total, rows, processing] = await Promise.all([
    db.contract.count({ where }),
    db.contract.findMany({
      where,
      orderBy: [{ receivedAt: dir }, { createdAt: dir }],
      skip: (query.page - 1) * LIST_PAGE_SIZE,
      take: LIST_PAGE_SIZE,
      select: {
        id: true, attachmentName: true, senderAddress: true, senderName: true, subject: true, status: true, attention: true,
        exception: true, placement: true, contentHash: true, receivedAt: true, createdAt: true, graphMessageId: true,
        documents: { where: { kind: "SIGNED" }, select: { kind: true } },
        draft: { select: { graphDraftId: true } },
      },
    }),
    db.contract.count({ where: { status: { in: STATUSES.processing } } }),
  ]);
  const siblings = await db.contract.groupBy({ by: ["graphMessageId"], where: { graphMessageId: { in: rows.map((r) => r.graphMessageId) } }, _count: true });
  const inEmail = Object.fromEntries(siblings.map((s) => [s.graphMessageId, s._count]));
  // Bulk approval is only offered where the owner is confirming a known position, never for an identical file that is already signed.
  const waiting = rows.filter((r) => r.status === "NEEDS_ATTENTION" && r.attention === "APPROVAL" && parsePlacement(r.placement));
  const signed = waiting.length
    ? await db.contract.findMany({ where: { contentHash: { in: waiting.map((r) => r.contentHash) }, documents: { some: { kind: "SIGNED" } } }, select: { id: true, contentHash: true } })
    : [];
  const canApprove = new Set(waiting.filter((r) => !signed.some((s) => s.contentHash === r.contentHash && s.id !== r.id)).map((r) => r.id));
  return {
    total,
    processing: processing > 0,
    rows: rows.map((r) => ({
      id: r.id,
      name: r.attachmentName,
      sender: r.senderName || r.senderAddress || "Unknown sender",
      senderAddress: r.senderAddress,
      subject: r.subject,
      status: statusView(r.status, r.attention),
      reason: r.status === "NEEDS_ATTENTION" || r.status === "FAILED" ? ownerMessage(r.status, r.attention, r.exception) : null,
      at: (r.receivedAt ?? r.createdAt).toISOString(),
      inEmail: inEmail[r.graphMessageId] ?? 1,
      needsYou: r.status === "NEEDS_ATTENTION" || r.status === "FAILED",
      canRetry: r.status === "FAILED",
      canApprove: canApprove.has(r.id),
      hasDraft: r.status === "DRAFT_SAVED" && Boolean(r.draft?.graphDraftId),
    })),
  };
}
