import { z } from "zod";
import { getDb } from "./db";
import type { RememberedPlacement } from "./placement";

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/;
const DOMAIN = /^@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

export const isEmail = (v: string) => v.length <= 254 && EMAIL.test(v);

// "Anna@Example.com" stays an address; "example.com" or "@example.com" means everyone at that domain.
export function normalizeSender(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (isEmail(v)) return v;
  const d = v.startsWith("@") ? v : `@${v}`;
  return DOMAIN.test(d) && d.length <= 254 ? d : null;
}

const emails = z
  .array(z.string())
  .max(50)
  .transform((l) => [...new Set(l.map((e) => e.trim().toLowerCase()).filter(Boolean))])
  .refine((l) => l.every(isEmail), "One of the addresses isn't a valid email address");

export const ruleInput = z.object({
  sender: z.string().max(254).transform((s, ctx) => {
    const n = normalizeSender(s);
    if (!n) ctx.addIssue({ code: "custom", message: "Enter an email address or a domain such as example.com" });
    return n ?? "";
  }),
  to: emails,
  cc: emails,
  autoSign: z.boolean(),
});
export type RuleInput = z.input<typeof ruleInput>;

export type SenderRule = Awaited<ReturnType<typeof listRules>>[number];

export const listRules = () => getDb().senderRule.findMany({ orderBy: { sender: "asc" } });

// The exact address wins over its domain.
export async function ruleFor(sender: string | null | undefined) {
  const s = sender?.trim().toLowerCase();
  if (!s || !s.includes("@")) return null;
  const domain = `@${s.split("@")[1]}`;
  const rows = await getDb().senderRule.findMany({ where: { sender: { in: [s, domain] } } });
  return rows.find((r) => r.sender === s) ?? rows.find((r) => r.sender === domain) ?? null;
}

export async function saveRule(raw: RuleInput, actor: string, id?: string) {
  const input = ruleInput.parse(raw);
  const db = getDb();
  const row = id
    ? await db.senderRule.update({ where: { id }, data: input })
    : await db.senderRule.upsert({ where: { sender: input.sender }, create: input, update: input });
  await db.auditEvent.create({ data: { actor, action: "sender-rule:saved", data: { sender: row.sender, autoSign: row.autoSign } } });
  return row;
}

export async function deleteRule(id: string, actor: string) {
  const db = getDb();
  const row = await db.senderRule.delete({ where: { id } });
  await db.auditEvent.create({ data: { actor, action: "sender-rule:deleted", data: { sender: row.sender } } });
}

// Remembers where this sender's documents are signed, creating the address rule when there is none.
export async function rememberPlacement(sender: string, placement: RememberedPlacement, actor: string) {
  const s = normalizeSender(sender);
  if (!s) return;
  const db = getDb();
  await db.senderRule.upsert({
    where: { sender: s },
    create: { sender: s, to: [], cc: [], placement },
    update: { placement },
  });
  await db.auditEvent.create({ data: { actor, action: "sender-rule:placement-saved", data: { sender: s } } });
}
