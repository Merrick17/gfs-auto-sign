import { budgetState } from "./budget";
import { getDb } from "./db";

const AI_SWITCH = "aiEnabled";

export async function isAiEnabled() {
  return (await getDb().appSetting.findUnique({ where: { key: AI_SWITCH } }))?.value !== false;
}

export async function setAiEnabled(on: boolean) {
  await getDb().appSetting.upsert({ where: { key: AI_SWITCH }, create: { key: AI_SWITCH, value: on }, update: { value: on } });
}

export async function setSpendingLimit(usd: number | null) {
  const db = getDb();
  if (usd === null) await db.appSetting.deleteMany({ where: { key: "monthlyAiBudgetUsd" } });
  else await db.appSetting.upsert({ where: { key: "monthlyAiBudgetUsd" }, create: { key: "monthlyAiBudgetUsd", value: usd }, update: { value: usd } });
}

export async function spendingSummary() {
  const db = getDb();
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const [budget, analysed, enabled, tokens] = await Promise.all([
    budgetState(),
    db.contractAnalysis.count({ where: { createdAt: { gte: start } } }),
    isAiEnabled(),
    db.usageRecord.aggregate({ _count: true, _sum: { inputTokens: true, outputTokens: true }, where: { source: "openai", createdAt: { gte: start } } }),
  ]);
  const percent = budget.limit ? Math.min(100, Math.round((budget.spent / budget.limit) * 100)) : null;
  return {
    spent: budget.spent,
    limit: budget.limit,
    percent,
    exhausted: budget.exhausted,
    nearLimit: budget.alert && !budget.exhausted,
    contractsAnalysed: analysed,
    averagePerContract: analysed > 0 ? budget.spent / analysed : null,
    enabled,
    // Technical detail for the diagnostics page only.
    diagnostics: { calls: tokens._count, inputTokens: tokens._sum.inputTokens ?? 0, outputTokens: tokens._sum.outputTokens ?? 0 },
  };
}
