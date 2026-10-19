import { z } from "zod";

// Shared by the form (browser) and the server action, so both enforce the same rules.
export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "AED", "TRY", "CNY"] as const;
export const PAYMENT_OPTIONS = ["30 days", "45 days", "60 days", "90 days", "Letter of credit", "Advance payment"];
export const DELIVERY_OPTIONS = ["EXW", "FCA", "FOB", "CFR", "CIF", "DAP", "DDP"];
export const CONTRACT_TYPES = [
  { value: "any", label: "Any contract" },
  { value: "sales", label: "Sales contract" },
] as const;

const email = z.string().trim().toLowerCase().pipe(z.email("That doesn't look like an email address"));

export const ruleFormSchema = z.object({
  id: z.string().optional(),
  enabled: z.boolean(),
  customerName: z.string().trim().min(2, "Choose a customer, or type the name as it appears on the contract").max(120),
  customerDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Enter a website address like acme.com")).max(5),
  contractType: z.enum(["any", "sales"]),
  maxAmount: z.number("Enter the highest amount you'd sign automatically").positive("The amount must be more than 0").max(1_000_000_000),
  currency: z.enum(CURRENCIES),
  paymentTerms: z.array(z.string().trim().min(1).max(60)).max(12),
  deliveryTerms: z.array(z.string().trim().min(1).max(60)).max(12),
  cc: z.array(email).max(20, "That's a lot of people to copy"),
  replyTo: z.array(email).max(10),
  instructions: z.string().trim().max(500, "Please keep notes under 500 characters"),
});

export type RuleForm = z.infer<typeof ruleFormSchema>;

const money = (n: number, c: string) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${c}`;

// "When a contract from Acme is below 50,000 EUR, ..." shown on every rule so it reads like a sentence.
export function ruleSentence(r: Pick<RuleForm, "customerName" | "maxAmount" | "currency" | "paymentTerms" | "deliveryTerms" | "cc" | "contractType">) {
  const terms = [...r.paymentTerms, ...r.deliveryTerms];
  const kind = r.contractType === "sales" ? "sales contract" : "contract";
  const parts = [`When a ${kind} arrives from ${r.customerName} for up to ${money(r.maxAmount, r.currency)}`];
  if (terms.length) parts.push(`with terms ${terms.slice(0, 3).join(", ")}${terms.length > 3 ? ` and ${terms.length - 3} more` : ""}`);
  const copy = r.cc.length ? ` and copy ${r.cc.length} ${r.cc.length === 1 ? "person" : "people"}` : "";
  return `${parts.join(" ")}, sign it${copy}. Anything else comes to you for review.`;
}
