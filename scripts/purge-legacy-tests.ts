// One-off: removes the documents, files and drafts an earlier test run left in the database in DATABASE_URL,
// using that run's own record list (secrets/e2e-state.legacy.json). Real documents are never touched.
//   npx tsx scripts/purge-legacy-tests.ts
import { readFileSync, renameSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const FILE = "secrets/e2e-state.legacy.json";

async function main() {
  const { getDb } = await import("@/lib/db");
  const { graph } = await import("@/lib/graph");
  const s = JSON.parse(readFileSync(FILE, "utf8")) as { contractIds: string[]; eventIds?: string[]; messages?: string[]; drafts?: string[]; driveItems?: string[]; imageIds?: string[] };
  const db = getDb();
  const ids = s.contractIds;
  const docs = await db.contract.findMany({ where: { id: { in: ids } }, select: { attachmentName: true } });
  console.log(`test documents found: ${docs.map((d) => d.attachmentName).join(", ") || "none"}`);

  const refs = await db.documentRef.findMany({ where: { contractId: { in: ids } } });
  const drafts = await db.outlookDraft.findMany({ where: { contractId: { in: ids } } });
  let remote = 0;
  const del = (path: string) => graph(path, { method: "DELETE" }).then(() => remote++, () => undefined);
  for (const id of new Set([...(s.drafts ?? []), ...drafts.flatMap((d) => (d.graphDraftId ? [d.graphDraftId] : [])), ...(s.messages ?? [])])) await del(`/me/messages/${id}`);
  for (const r of refs) await del(`/drives/${r.driveId}/items/${r.itemId}`);
  for (const id of s.driveItems ?? []) await del(`/me/drive/items/${id}`);

  const w = { contractId: { in: ids } };
  await db.auditEvent.deleteMany({ where: w });
  await db.outlookDraft.deleteMany({ where: w });
  await db.documentRef.deleteMany({ where: w });
  await db.contractAnalysis.deleteMany({ where: w });
  await db.usageRecord.deleteMany({ where: w });
  const c = await db.contract.deleteMany({ where: { id: { in: ids } } });
  await db.processingJob.deleteMany({ where: { eventId: { in: s.eventIds ?? [] } } });
  await db.incomingEvent.deleteMany({ where: { id: { in: s.eventIds ?? [] } } });
  const imgs = await db.signatureImage.deleteMany({ where: { id: { in: s.imageIds ?? [] }, active: false } });
  console.log(`deleted ${c.count} test documents, ${imgs.count} old test signature images, ${remote} Outlook/OneDrive items`);
  console.log(`documents left: ${await db.contract.count()}`);
  renameSync(FILE, `${FILE}.done`);
}

main().then(() => process.exit(0), (e) => { console.error("FATAL", (e as Error).message); process.exit(1); });
