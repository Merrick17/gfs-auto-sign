// Reads documents that are waiting for the owner and were never read by the AI, to find where the signature goes.
// Nothing is signed: with automatic signing off (or no signature image) every document keeps waiting for the owner,
// now with a suggested position.
//   npx tsx scripts/read-documents.ts [limit]
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const { getDb } = await import("@/lib/db");
  const { processDocument } = await import("@/lib/processing");
  const { aiAvailable } = await import("@/lib/analysis");
  const { markFailed } = await import("@/lib/pipeline");
  if (!aiAvailable()) throw new Error("OPENAI_API_KEY is not set");
  const db = getDb();
  const limit = Number(process.argv[2] ?? 1000);
  const docs = await db.contract.findMany({
    where: { status: "NEEDS_ATTENTION", analyses: { none: {} }, documents: { none: { kind: "SIGNED" } } },
    select: { id: true, attachmentName: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  console.log(`${docs.length} documents to read`);
  for (const d of docs) {
    // Back to "received" so step 2 runs again; the draft step is never reached without a signature.
    await db.contract.update({ where: { id: d.id }, data: { status: "RECEIVED", attention: null, exception: null } });
    try {
      await processDocument(d.id, async () => undefined);
    } catch (e) {
      await markFailed(d.id, e);
    }
    const [after, a] = await Promise.all([
      db.contract.findUniqueOrThrow({ where: { id: d.id }, select: { status: true, attention: true, placement: true } }),
      db.contractAnalysis.findFirst({ where: { contractId: d.id }, orderBy: { createdAt: "desc" }, select: { result: true, model: true } }),
    ]);
    const r = a?.result as { needsSignature?: boolean; confidence?: number; signatureLocations?: { page: number; evidence: string }[] } | undefined;
    console.log(
      `${d.attachmentName.slice(0, 48).padEnd(48)} ${after.status}${after.attention ? `/${after.attention}` : ""}  ` +
        (r ? `sign=${r.needsSignature} conf=${r.confidence} spot=${r.signatureLocations?.[0] ? `p${r.signatureLocations[0].page} "${r.signatureLocations[0].evidence.slice(0, 40)}"` : "none"} (${a?.model})` : "not read"),
    );
  }
}

main().then(() => process.exit(0), (e) => { console.error("FATAL", (e as Error).message); process.exit(1); });
