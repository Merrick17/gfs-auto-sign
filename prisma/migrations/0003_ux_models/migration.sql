-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "senderAddress" TEXT;

-- AlterTable
ALTER TABLE "ContractAnalysis" ADD COLUMN     "ruleId" TEXT;

-- AlterTable
ALTER TABLE "SignatureProfile" ALTER COLUMN "signatureImageRef" DROP NOT NULL;

-- AlterTable
ALTER TABLE "OAuthConnection" ADD COLUMN     "accountEmail" TEXT,
ADD COLUMN     "accountName" TEXT;

-- CreateTable
CREATE TABLE "SigningRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "customerName" TEXT NOT NULL,
    "customerDomains" TEXT[],
    "contractType" TEXT NOT NULL DEFAULT 'any',
    "maxAmount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "paymentTerms" TEXT[],
    "deliveryTerms" TEXT[],
    "instructions" TEXT NOT NULL DEFAULT '',
    "replyTo" TEXT[],
    "cc" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SigningRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureImage" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "driveId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "organization" TEXT,
    "domain" TEXT NOT NULL,
    "sources" TEXT[],
    "outlookContactId" TEXT,
    "lastInteractionAt" TIMESTAMP(3),
    "toCount" INTEGER NOT NULL DEFAULT 0,
    "ccCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentRecipient" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "conversationId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "toDomains" TEXT[],

    CONSTRAINT "SentRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SigningRule_customerName_idx" ON "SigningRule"("customerName");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureImage_version_key" ON "SignatureImage"("version");

-- CreateIndex
CREATE INDEX "SignatureImage_active_idx" ON "SignatureImage"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_email_key" ON "Contact"("email");

-- CreateIndex
CREATE INDEX "Contact_domain_idx" ON "Contact"("domain");

-- CreateIndex
CREATE INDEX "SentRecipient_email_idx" ON "SentRecipient"("email");

-- CreateIndex
CREATE INDEX "SentRecipient_conversationId_idx" ON "SentRecipient"("conversationId");

-- CreateIndex
CREATE INDEX "SentRecipient_sentAt_idx" ON "SentRecipient"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "SentRecipient_messageId_email_role_key" ON "SentRecipient"("messageId", "email", "role");

