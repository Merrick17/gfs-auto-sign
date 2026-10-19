import { getDb } from "./db";
import { policyRules, type PolicyRules } from "./policy";
import { readiness } from "./readiness";
import type { RuleForm } from "./rule-schema";

// JSON round-tripped through Postgres comes back with its keys in a different order, so compare canonically.
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

const KEYWORDS = "reviewKeywords";
const SWITCH = "automaticSigning";

export const CONTRACT_TYPE_WORDS: Record<RuleForm["contractType"], string[]> = { any: [], sales: ["sales"] };

type RuleRow = Awaited<ReturnType<ReturnType<typeof getDb>["signingRule"]["findMany"]>>[number];

export const toForm = (r: RuleRow): RuleForm => ({
  id: r.id,
  enabled: r.enabled,
  customerName: r.customerName,
  customerDomains: r.customerDomains,
  contractType: r.contractType === "sales" ? "sales" : "any",
  maxAmount: Number(r.maxAmount),
  currency: r.currency as RuleForm["currency"],
  paymentTerms: r.paymentTerms,
  deliveryTerms: r.deliveryTerms,
  cc: r.cc,
  replyTo: r.replyTo,
  instructions: r.instructions,
});

export async function listRules() {
  return (await getDb().signingRule.findMany({ orderBy: [{ customerName: "asc" }, { createdAt: "asc" }] })).map(toForm);
}

export async function getReviewKeywords(): Promise<string[]> {
  const s = await getDb().appSetting.findUnique({ where: { key: KEYWORDS } });
  return Array.isArray(s?.value) ? (s.value as string[]) : [];
}

export async function isAutomaticSigningOn() {
  return (await getDb().appSetting.findUnique({ where: { key: SWITCH } }))?.value === true;
}

// Compiles the owner's rules into the policy document the signing pipeline enforces.
// A new version is written only when something actually changed, so the history stays meaningful.
export async function publishPolicy(actor: string) {
  const db = getDb();
  const [rows, keywords, on] = await Promise.all([
    db.signingRule.findMany({ where: { enabled: true }, orderBy: { createdAt: "asc" } }),
    getReviewKeywords(),
    isAutomaticSigningOn(),
  ]);
  const compiled: PolicyRules = policyRules.parse({
    minConfidence: 0.8,
    mandatoryReviewKeywords: keywords,
    customers: rows.map((r) => ({
      ruleId: r.id,
      name: r.customerName,
      currency: r.currency,
      maxAmount: Number(r.maxAmount),
      contractTypes: CONTRACT_TYPE_WORDS[r.contractType === "sales" ? "sales" : "any"],
      paymentTerms: r.paymentTerms,
      deliveryTerms: r.deliveryTerms,
      replyTo: r.replyTo,
      cc: r.cc,
      instructions: r.instructions,
    })),
  });
  const current = await db.signingPolicy.findFirst({ where: { active: true }, orderBy: { version: "desc" } });
  if (current && current.autonomousSigningEnabled === on && canon(current.rules) === canon(compiled)) return current.version;
  return db.$transaction(async (tx) => {
    const last = await tx.signingPolicy.findFirst({ orderBy: { version: "desc" } });
    await tx.signingPolicy.updateMany({ where: { active: true }, data: { active: false } });
    const row = await tx.signingPolicy.create({
      data: { version: (last?.version ?? 0) + 1, active: true, autonomousSigningEnabled: on, rules: compiled, createdBy: actor },
    });
    await tx.auditEvent.create({ data: { actor: "owner", action: "policy:published", data: { version: row.version, rules: rows.length, automaticSigning: on } } });
    return row.version;
  });
}

export async function saveRule(input: RuleForm, actor: string) {
  const db = getDb();
  const data = {
    enabled: input.enabled,
    name: input.customerName,
    customerName: input.customerName,
    customerDomains: input.customerDomains,
    contractType: input.contractType,
    maxAmount: input.maxAmount,
    currency: input.currency,
    paymentTerms: input.paymentTerms,
    deliveryTerms: input.deliveryTerms,
    cc: [...new Set(input.cc)],
    replyTo: [...new Set(input.replyTo)],
    instructions: input.instructions,
  };
  const row = input.id ? await db.signingRule.update({ where: { id: input.id }, data }) : await db.signingRule.create({ data });
  await db.auditEvent.create({ data: { actor: "owner", action: input.id ? "rule:updated" : "rule:created", data: { ruleId: row.id, customer: row.customerName } } });
  await publishPolicy(actor);
  return toForm(row);
}

export async function deleteRule(id: string, actor: string) {
  const db = getDb();
  await db.signingRule.delete({ where: { id } });
  await db.auditEvent.create({ data: { actor: "owner", action: "rule:deleted", data: { ruleId: id } } });
  await publishPolicy(actor);
}

export async function setRuleEnabled(id: string, enabled: boolean, actor: string) {
  await getDb().signingRule.update({ where: { id }, data: { enabled } });
  await publishPolicy(actor);
}

export async function setReviewKeywords(words: string[], actor: string) {
  const clean = [...new Set(words.map((w) => w.trim()).filter(Boolean))].slice(0, 30);
  await getDb().appSetting.upsert({ where: { key: KEYWORDS }, create: { key: KEYWORDS, value: clean }, update: { value: clean } });
  await publishPolicy(actor);
}

export class NotReady extends Error {
  constructor(public missing: string[]) {
    super(`Finish setup first: ${missing.join(", ")}`);
  }
}

// Automatic signing can only be switched on when everything it depends on genuinely exists.
export async function setAutomaticSigning(on: boolean, actor: string) {
  const db = getDb();
  if (on) {
    const r = await readiness();
    if (r.missing.length) throw new NotReady(r.missing);
  }
  await db.appSetting.upsert({ where: { key: SWITCH }, create: { key: SWITCH, value: on }, update: { value: on } });
  await db.auditEvent.create({ data: { actor: "owner", action: on ? "automatic-signing:on" : "automatic-signing:off" } });
  await publishPolicy(actor);
}
