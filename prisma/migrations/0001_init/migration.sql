-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "MailboxConnection" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphSubscription" (
    "id" TEXT NOT NULL,
    "graphId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "clientState" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GraphSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomingEvent" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "graphMessageId" TEXT,
    "subscriptionId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dispatchStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "triggerRunId" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'EMAIL_RECEIVED',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "graphMessageId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "attachmentName" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "contractNumber" TEXT,
    "revision" TEXT NOT NULL DEFAULT '0',
    "customer" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "stage" TEXT NOT NULL DEFAULT 'EMAIL_RECEIVED',
    "originalDocId" TEXT,
    "signedDocId" TEXT,
    "conversationId" TEXT,
    "costUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "exception" TEXT,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractAnalysis" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "decision" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "policyVersion" INTEGER,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SigningPolicy" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "autonomousSigningEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "SigningPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureProfile" (
    "id" TEXT NOT NULL,
    "signatoryName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "signatureImageRef" TEXT NOT NULL,
    "certificateRef" TEXT NOT NULL,
    "certificateFingerprint" TEXT NOT NULL,
    "certSubject" TEXT NOT NULL,
    "certNotAfter" TIMESTAMP(3) NOT NULL,
    "selfSigned" BOOLEAN NOT NULL DEFAULT true,
    "runtimeApprovedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRef" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "verification" JSONB,
    "policyVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutlookDraft" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "graphDraftId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'CREATING',
    "marker" TEXT NOT NULL,
    "to" JSONB,
    "cc" JSONB,
    "attachmentOk" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutlookDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "contractId" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "contractId" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,4) NOT NULL,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailboxConnection_mailboxId_key" ON "MailboxConnection"("mailboxId");

-- CreateIndex
CREATE UNIQUE INDEX "GraphSubscription_graphId_key" ON "GraphSubscription"("graphId");

-- CreateIndex
CREATE INDEX "GraphSubscription_expiresAt_idx" ON "GraphSubscription"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IncomingEvent_dedupeKey_key" ON "IncomingEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "IncomingEvent_dispatchStatus_receivedAt_idx" ON "IncomingEvent"("dispatchStatus", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingJob_eventId_key" ON "ProcessingJob"("eventId");

-- CreateIndex
CREATE INDEX "Contract_status_createdAt_idx" ON "Contract"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Contract_customer_contractNumber_idx" ON "Contract"("customer", "contractNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_mailboxId_graphMessageId_attachmentId_contentHash_key" ON "Contract"("mailboxId", "graphMessageId", "attachmentId", "contentHash");

-- CreateIndex
CREATE INDEX "ContractAnalysis_contractId_idx" ON "ContractAnalysis"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "SigningPolicy_version_key" ON "SigningPolicy"("version");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRef_contractId_kind_key" ON "DocumentRef"("contractId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "OutlookDraft_contractId_key" ON "OutlookDraft"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "OutlookDraft_marker_key" ON "OutlookDraft"("marker");

-- CreateIndex
CREATE INDEX "AuditEvent_contractId_createdAt_idx" ON "AuditEvent"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_source_createdAt_idx" ON "UsageRecord"("source", "createdAt");

-- AddForeignKey
ALTER TABLE "GraphSubscription" ADD CONSTRAINT "GraphSubscription_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "MailboxConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomingEvent" ADD CONSTRAINT "IncomingEvent_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "MailboxConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IncomingEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractAnalysis" ADD CONSTRAINT "ContractAnalysis_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRef" ADD CONSTRAINT "DocumentRef_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutlookDraft" ADD CONSTRAINT "OutlookDraft_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

