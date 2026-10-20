import { getDb } from "./db";
import { audit } from "./pipeline";

export const MAX_AUTO_RETRIES = 3;
const BASE_DELAY_MS = 5 * 60_000; // 5, 10, 20 minutes

// Failures only the owner can fix are not retried: they would fail again the same way.
const NEEDS_OWNER = new Set(["AuthRequired", "SendBlocked"]);

export type RetryKind = "process" | "draft";

// Finds failed documents whose wait is over and hands each to `start`. The attempt is recorded before starting,
// so a crash in between can't cause an unbounded loop.
export async function retryFailedDocuments(start: (contractId: string, kind: RetryKind, attempt: number) => Promise<unknown>, now = Date.now()) {
  const db = getDb();
  const failed = await db.contract.findMany({
    where: { status: "FAILED" },
    select: {
      id: true,
      updatedAt: true,
      documents: { select: { kind: true } },
      audits: { where: { action: { in: ["auto-retry", "failed"] } }, orderBy: { createdAt: "desc" }, select: { action: true, data: true } },
    },
    take: 100,
  });
  const started: string[] = [];
  for (const c of failed) {
    const attempts = c.audits.filter((a) => a.action === "auto-retry").length;
    const lastError = (c.audits.find((a) => a.action === "failed")?.data as { error?: string } | null)?.error;
    if (attempts >= MAX_AUTO_RETRIES || (lastError && NEEDS_OWNER.has(lastError))) continue;
    if (now - c.updatedAt.getTime() < BASE_DELAY_MS * 2 ** attempts) continue;
    const kind: RetryKind = c.documents.some((d) => d.kind === "SIGNED") ? "draft" : "process";
    // Claimed atomically: only one retry starts even if two schedules overlap.
    const claimed = await db.contract.updateMany({ where: { id: c.id, status: "FAILED", updatedAt: c.updatedAt }, data: { status: kind === "draft" ? "SIGNED" : "RECEIVED", exception: null } });
    if (claimed.count === 0) continue;
    await audit(c.id, "auto-retry", { attempt: attempts + 1, kind });
    await start(c.id, kind, attempts + 1);
    started.push(c.id);
  }
  return { started };
}
