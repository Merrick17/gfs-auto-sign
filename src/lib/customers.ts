import { getDb } from "./db";

export type CustomerOption = { name: string; domains: string[]; contracts: number; hasRule: boolean };

// Customers the owner can pick from: real names seen on received contracts plus any already used in a rule.
export async function listCustomers(): Promise<CustomerOption[]> {
  const db = getDb();
  const [rules, contracts] = await Promise.all([
    db.signingRule.findMany({ select: { customerName: true, customerDomains: true } }),
    db.contract.findMany({ where: { customer: { not: null } }, select: { customer: true, senderAddress: true } }),
  ]);
  const byKey = new Map<string, CustomerOption>();
  const entry = (name: string) => {
    const key = name.trim().toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { name: name.trim(), domains: [], contracts: 0, hasRule: false });
    return byKey.get(key)!;
  };
  for (const r of rules) {
    const e = entry(r.customerName);
    e.hasRule = true;
    for (const d of r.customerDomains) if (!e.domains.includes(d)) e.domains.push(d);
  }
  for (const c of contracts) {
    const e = entry(c.customer!);
    e.contracts++;
    const d = c.senderAddress?.split("@")[1];
    if (d && !e.domains.includes(d)) e.domains.push(d);
  }
  return [...byKey.values()].sort((a, b) => b.contracts - a.contracts || a.name.localeCompare(b.name));
}
