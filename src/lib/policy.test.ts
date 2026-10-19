import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContractExtraction } from "./contract-schema";
import { evaluate, type PolicyContext } from "./policy";

const doc: ContractExtraction = {
  isSalesContract: true, customer: "Acme GmbH", contractNumber: "SC-1", version: "1", contractDate: "2026-01-01",
  currency: "EUR", amount: 10000, contractType: "Sales", language: "en", articles: [], paymentTerms: "30 days net",
  deliveryTerms: "FOB Shanghai", obligations: [], unusualCommitments: [], existingSignatures: [],
  gfsSignatureLocations: [{ page: 1, x: 0.1, y: 0.8, width: 0.3, height: 0.08, evidence: "GFS signature" }],
  inconsistencies: [], missingFields: [], historyDeviations: [], promptInjectionSuspected: false, confidence: 0.95, evidence: [],
};

const ctx: PolicyContext = {
  mandateEnabled: true, policyVersion: 3, signerReady: true, alreadySigned: false,
  rules: {
    minConfidence: 0.8, mandatoryReviewKeywords: ["exclusivity"],
    customers: [{ name: "acme gmbh", currency: "EUR", maxAmount: 50000, contractTypes: [], paymentTerms: ["30 days"], deliveryTerms: ["FOB"], replyTo: [], cc: [], instructions: "" }],
  },
};

test("approves a contract inside the mandate", () => assert.equal(evaluate(doc, ctx).approve, true));
test("blocks when the mandate is off", () => assert.equal(evaluate(doc, { ...ctx, mandateEnabled: false }).approve, false));
test("blocks amounts over the limit", () => assert.equal(evaluate({ ...doc, amount: 50001 }, ctx).approve, false));
test("blocks unknown customers", () => assert.equal(evaluate({ ...doc, customer: "Other" }, ctx).approve, false));
test("blocks unapproved payment terms", () => assert.equal(evaluate({ ...doc, paymentTerms: "90 days" }, ctx).approve, false));
test("blocks prompt injection", () => assert.equal(evaluate({ ...doc, promptInjectionSuspected: true }, ctx).approve, false));
test("blocks mandatory-review keywords", () =>
  assert.equal(evaluate({ ...doc, obligations: ["Grants exclusivity in EU"] }, ctx).approve, false));
test("blocks re-signing the same revision", () => assert.equal(evaluate(doc, { ...ctx, alreadySigned: true }).approve, false));
test("blocks when the signer is not approved", () => assert.equal(evaluate(doc, { ...ctx, signerReady: false }).approve, false));
