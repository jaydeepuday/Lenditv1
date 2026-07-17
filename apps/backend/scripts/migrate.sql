ALTER TABLE "chats" 
ADD COLUMN IF NOT EXISTS "itemId" TEXT,
ADD COLUMN IF NOT EXISTS "renterId" TEXT,
ADD COLUMN IF NOT EXISTS "lenderId" TEXT,
ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

UPDATE "chats" c
SET 
    "itemId" = t."itemId",
    "renterId" = t."renterId",
    "lenderId" = t."lenderId"
FROM "borrow_transactions" t
WHERE c."transactionId" = t."id";

DELETE FROM "chats" WHERE "itemId" IS NULL;

WITH RankedChats AS (
    SELECT id,
            ROW_NUMBER() OVER(PARTITION BY "itemId", "renterId" ORDER BY "createdAt" DESC) as rn
    FROM "chats"
)
DELETE FROM "chats" WHERE id IN (SELECT id FROM RankedChats WHERE rn > 1);
