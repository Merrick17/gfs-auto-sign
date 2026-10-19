import { contractExtraction } from "./contract-schema";
import { getDb } from "./db";
import { setStage } from "./pipeline";
import { evaluate, policyRules } from "./policy";

// `next` queues signing; called only for an approved decision.
export async function authorizeContractSigning(contractId: string, next: () => Promise<unknown>) {
  const db = getDb();
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
  if (["SIGNING", "SIGNED", "STORED", "DRAFT_READY"].includes(c.status)) return { skipped: c.status };

  await setStage(contractId, "EVALUATING", { status: "ANALYZING" });
  const analysis = await db.contractAnalysis.findFirstOrThrow({ where: { contractId }, orderBy: { createdAt: "desc" } });
  const extracted = contractExtraction.parse(analysis.result);

  const policy = await db.signingPolicy.findFirst({ where: { active: true }, orderBy: { version: "desc" } });
  const profile = await db.signatureProfile.findFirst({ where: { active: true } });
  const image = await db.signatureImage.findFirst({ where: { active: true } });
  const rules = policy ? policyRules.safeParse(policy.rules) : null;
  const alreadySigned = extracted.contractNumber
    ? (await db.contract.count({
        where: {
          id: { not: contractId },
          customer: c.customer,
          contractNumber: extracted.contractNumber,
          revision: c.revision,
          status: { in: ["SIGNED", "STORED", "DRAFT_READY"] },
        },
      })) > 0
    : false;

  const decision = evaluate(extracted, {
    mandateEnabled: Boolean(policy?.autonomousSigningEnabled),
    policyVersion: policy?.version ?? null,
    rules: rules?.success ? rules.data : null,
    signerReady: Boolean(image && profile?.runtimeApprovedAt && profile.certNotAfter > new Date()),
    alreadySigned,
  });

  await db.contractAnalysis.update({
    where: { id: analysis.id },
    data: { decision: decision.approve ? "APPROVE" : "REVIEW", reasons: decision.reasons, policyVersion: policy?.version ?? null, ruleId: decision.customerRule?.ruleId ?? null },
  });

  if (!decision.approve) {
    await setStage(contractId, "REQUIRES_REVIEW", { status: "NEEDS_REVIEW", exception: decision.reasons.join(" | ") });
    return { approved: false, reasons: decision.reasons };
  }
  await db.contract.update({ where: { id: contractId }, data: { status: "AUTHORIZED" } });
  await next();
  return { approved: true, policyVersion: policy?.version };
}
