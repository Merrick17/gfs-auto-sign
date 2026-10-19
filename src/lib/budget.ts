import { getDb } from "./db";

type Price = { in: number; out: number }; // USD per 1M tokens, set by the owner in env

function price(model: string): Price {
  const key = model.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return { in: Number(process.env[`PRICE_IN_${key}`] ?? 0), out: Number(process.env[`PRICE_OUT_${key}`] ?? 0) };
}

export const costOf = (model: string, inputTokens: number, outputTokens: number) => {
  const p = price(model);
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
};

export async function monthSpendUsd(): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const r = await getDb().usageRecord.aggregate({
    _sum: { costUsd: true },
    where: { source: "openai", createdAt: { gte: start } },
  });
  return Number(r._sum.costUsd ?? 0);
}

export async function budgetState() {
  const s = await getDb().appSetting.findUnique({ where: { key: "monthlyAiBudgetUsd" } });
  const limit = s ? Number(s.value) : null;
  const spent = await monthSpendUsd();
  return { limit, spent, exhausted: limit !== null && spent >= limit, alert: limit !== null && spent >= limit * 0.8 };
}
