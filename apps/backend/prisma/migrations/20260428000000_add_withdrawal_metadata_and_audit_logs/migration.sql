-- Data-safe additive repair migration.
-- This intentionally avoids reset, drop, truncate, or seed operations.

ALTER TYPE "WithdrawalStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

ALTER TABLE "withdrawal_requests"
  ADD COLUMN IF NOT EXISTS "reference" TEXT,
  ADD COLUMN IF NOT EXISTS "processedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "txId" TEXT,
  "userId" TEXT,
  "amount" DOUBLE PRECISION,
  "metadata" JSONB,
  "severity" TEXT NOT NULL DEFAULT 'INFO',
  "previousHash" TEXT,
  "hash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
