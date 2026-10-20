-- Four-step document flow: email received, document ingested, signature image added, Outlook draft saved.

-- Contract: email context and the signature position, without the customer/pricing fields.
ALTER TABLE "Contract"
  ADD COLUMN "subject" TEXT,
  ADD COLUMN "senderName" TEXT,
  ADD COLUMN "receivedAt" TIMESTAMP(3),
  ADD COLUMN "attention" TEXT,
  ADD COLUMN "placement" JSONB,
  ADD COLUMN "pageCount" INTEGER;

-- Existing records keep their outcome under the new status names.
UPDATE "Contract" SET "status" = 'DRAFT_SAVED' WHERE "status" = 'DRAFT_READY';
UPDATE "Contract" SET "status" = 'SKIPPED' WHERE "status" = 'IGNORED';
UPDATE "Contract" SET "status" = 'NEEDS_ATTENTION', "attention" = 'APPROVAL' WHERE "status" = 'NEEDS_REVIEW';
UPDATE "Contract" c SET "status" = 'SIGNED'
  WHERE c."status" IN ('SIGNING', 'SIGNED', 'STORED')
    AND EXISTS (SELECT 1 FROM "DocumentRef" d WHERE d."contractId" = c."id" AND d."kind" = 'SIGNED');
UPDATE "Contract" c SET "status" = 'FAILED', "exception" = 'Processing was interrupted. Retry to continue.'
  WHERE c."status" IN ('ANALYZING', 'AUTHORIZED', 'SIGNING', 'SIGNED', 'STORED')
    AND NOT EXISTS (SELECT 1 FROM "DocumentRef" d WHERE d."contractId" = c."id" AND d."kind" = 'SIGNED');
UPDATE "Contract" SET "receivedAt" = "createdAt" WHERE "receivedAt" IS NULL;

DROP INDEX IF EXISTS "Contract_customer_contractNumber_idx";
ALTER TABLE "Contract"
  DROP COLUMN "contractNumber",
  DROP COLUMN "revision",
  DROP COLUMN "customer",
  DROP COLUMN "stage",
  DROP COLUMN "originalDocId",
  DROP COLUMN "signedDocId",
  DROP COLUMN "costUsd";
CREATE INDEX "Contract_contentHash_idx" ON "Contract"("contentHash");

ALTER TABLE "ContractAnalysis" DROP COLUMN "policyVersion", DROP COLUMN "ruleId";
ALTER TABLE "DocumentRef" DROP COLUMN "verification", DROP COLUMN "policyVersion";
ALTER TABLE "OutlookDraft" ADD COLUMN "webLink" TEXT;

-- Per-sender draft rules replace the customer signing rules.
CREATE TABLE "SenderRule" (
    "id" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "to" TEXT[],
    "cc" TEXT[],
    "autoSign" BOOLEAN NOT NULL DEFAULT false,
    "placement" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SenderRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SenderRule_sender_key" ON "SenderRule"("sender");

-- Recipients already chosen per customer domain carry over. Automatic signing starts off again.
INSERT INTO "SenderRule" ("id", "sender", "to", "cc", "updatedAt")
SELECT 'r' || substr(md5(random()::text || d.domain), 1, 24), '@' || lower(d.domain), r."replyTo", r."cc", CURRENT_TIMESTAMP
FROM "SigningRule" r, unnest(r."customerDomains") AS d(domain)
WHERE d.domain <> ''
ON CONFLICT ("sender") DO NOTHING;

DROP TABLE "SigningRule";
DROP TABLE "SigningPolicy";
DROP TABLE "SignatureProfile";
