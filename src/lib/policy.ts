import { z } from "zod";
import type { ContractExtraction } from "./contract-schema";

export const policyRules = z.object({
  customers: z.array(
    z.object({
      name: z.string(),
      currency: z.string(),
      maxAmount: z.number(),
      contractTypes: z.array(z.string()).default([]), // empty = any
      paymentTerms: z.array(z.string()).default([]), // substrings; empty = any
      deliveryTerms: z.array(z.string()).default([]),
      replyTo: z.array(z.string()).default([]),
      cc: z.array(z.string()).default([]),
      instructions: z.string().default(""),
    }),
  ),
  mandatoryReviewKeywords: z.array(z.string()).default([]),
  minConfidence: z.number().default(0.8),
});

export type PolicyRules = z.infer<typeof policyRules>;

export type PolicyContext = {
  mandateEnabled: boolean;
  policyVersion: number | null;
  rules: PolicyRules | null;
  signerReady: boolean; // active profile, valid cert, owner approved the signing runtime
  alreadySigned: boolean; // same customer + number + revision already signed
};

export type Decision = { approve: boolean; reasons: string[]; customerRule?: PolicyRules["customers"][number] };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Deterministic and independent of any text in the email or PDF.
export function evaluate(d: ContractExtraction, ctx: PolicyContext): Decision {
  const reasons: string[] = [];
  if (!ctx.mandateEnabled || !ctx.rules || ctx.policyVersion === null) reasons.push("No active signing mandate");
  if (!ctx.signerReady) reasons.push("Signing certificate not approved for the automated runtime");
  if (ctx.alreadySigned) reasons.push("This contract revision was already signed");
  if (!d.isSalesContract) reasons.push("Not recognised as a sales contract");
  if (d.promptInjectionSuspected) reasons.push("Document contains instructions aimed at the agent");
  if (d.gfsSignatureLocations.length === 0) reasons.push("No GFS signature location found");
  if (d.inconsistencies.length) reasons.push(`Inconsistencies: ${d.inconsistencies.join("; ")}`);
  if (d.missingFields.length) reasons.push(`Missing fields: ${d.missingFields.join(", ")}`);
  if (d.unusualCommitments.length) reasons.push(`Unusual commitments: ${d.unusualCommitments.join("; ")}`);
  if (d.historyDeviations.length) reasons.push(`Deviates from customer history: ${d.historyDeviations.join("; ")}`);
  if (!d.contractNumber) reasons.push("Contract number missing");

  let rule: Decision["customerRule"];
  if (ctx.rules) {
    if (d.confidence < ctx.rules.minConfidence) reasons.push(`Low extraction confidence (${d.confidence})`);
    rule = d.customer ? ctx.rules.customers.find((c) => norm(c.name) === norm(d.customer!)) : undefined;
    if (!rule) reasons.push("Customer is not on the approved list");
    else {
      if (d.amount === null) reasons.push("Amount missing");
      else if (d.amount > rule.maxAmount) reasons.push(`Amount ${d.amount} exceeds limit ${rule.maxAmount}`);
      if (!d.currency || norm(d.currency) !== norm(rule.currency)) reasons.push("Currency differs from the approved currency");
      if (rule.contractTypes.length && !(d.contractType && rule.contractTypes.some((t) => norm(t) === norm(d.contractType!))))
        reasons.push("Contract type not approved");
      if (rule.paymentTerms.length && !(d.paymentTerms && rule.paymentTerms.some((t) => norm(d.paymentTerms!).includes(norm(t)))))
        reasons.push("Payment terms not approved");
      if (rule.deliveryTerms.length && !(d.deliveryTerms && rule.deliveryTerms.some((t) => norm(d.deliveryTerms!).includes(norm(t)))))
        reasons.push("Delivery terms not approved");
    }
    const haystack = norm([...d.obligations, d.paymentTerms ?? "", d.deliveryTerms ?? ""].join(" "));
    for (const k of ctx.rules.mandatoryReviewKeywords)
      if (k && haystack.includes(norm(k))) reasons.push(`Mandatory-review term: ${k}`);
  }
  return { approve: reasons.length === 0, reasons, customerRule: rule };
}
