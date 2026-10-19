import { z } from "zod";

const loc = z.object({
  page: z.number().int(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(), // fractions of the page, origin top-left
  evidence: z.string(),
});

export const contractExtraction = z.object({
  isSalesContract: z.boolean(),
  customer: z.string().nullable(),
  contractNumber: z.string().nullable(),
  version: z.string().nullable(),
  contractDate: z.string().nullable(),
  currency: z.string().nullable(),
  amount: z.number().nullable(),
  contractType: z.string().nullable(),
  language: z.string().nullable(),
  articles: z.array(z.object({ style: z.string(), quantity: z.number().nullable() })),
  paymentTerms: z.string().nullable(),
  deliveryTerms: z.string().nullable(),
  obligations: z.array(z.string()),
  unusualCommitments: z.array(z.string()),
  existingSignatures: z.array(
    z.object({ signer: z.string().nullable(), kind: z.enum(["digital", "visual"]), page: z.number().int().nullable() }),
  ),
  gfsSignatureLocations: z.array(loc),
  inconsistencies: z.array(z.string()),
  missingFields: z.array(z.string()),
  historyDeviations: z.array(z.string()),
  promptInjectionSuspected: z.boolean(),
  confidence: z.number(),
  evidence: z.array(z.object({ field: z.string(), quote: z.string(), page: z.number().int().nullable() })),
});

export type ContractExtraction = z.infer<typeof contractExtraction>;
