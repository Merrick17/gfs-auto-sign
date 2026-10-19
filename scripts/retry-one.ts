import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
process.env.AI_MOCK = "1";
async function main() {
  const id = process.argv[2];
  const { getDb } = await import("@/lib/db");
  const { analyzeContract } = await import("@/lib/analysis");
  const { authorizeContractSigning } = await import("@/lib/authorization");
  const { signContract } = await import("@/lib/signing");
  const { storeSigned } = await import("@/lib/store");
  const { createReplyDraft } = await import("@/lib/drafts");
  await analyzeContract(id, () => authorizeContractSigning(id, () => signContract(id, () => storeSigned(id, () => createReplyDraft(id)))));
  const c = await getDb().contract.findUniqueOrThrow({ where: { id } });
  console.log("after retry:", c.status, "|", c.exception);
  console.log("analyses:", await getDb().contractAnalysis.count({ where: { contractId: id } }));
}
main().then(() => process.exit(0), (e) => { console.error("ERR", e.message, e.cause?.message ?? ""); process.exit(1); });
