require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('Starting chat backfill...');

    try {
        await prisma.$executeRawUnsafe(`
            ALTER TABLE "chats" 
            ADD COLUMN IF NOT EXISTS "itemId" TEXT,
            ADD COLUMN IF NOT EXISTS "renterId" TEXT,
            ADD COLUMN IF NOT EXISTS "lenderId" TEXT,
            ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
        `);

        console.log('Columns added. Backfilling data...');

        await prisma.$executeRawUnsafe(`
            UPDATE "chats" c
            SET 
                "itemId" = t."itemId",
                "renterId" = t."renterId",
                "lenderId" = t."lenderId"
            FROM "borrow_transactions" t
            WHERE c."transactionId" = t."id";
        `);

        console.log('Data backfilled. Cleaning orphans...');

        await prisma.$executeRawUnsafe(`
            DELETE FROM "chats" WHERE "itemId" IS NULL;
        `);

        console.log('Deduplicating chats...');
        await prisma.$executeRawUnsafe(`
            WITH RankedChats AS (
                SELECT id,
                       ROW_NUMBER() OVER(PARTITION BY "itemId", "renterId" ORDER BY "createdAt" DESC) as rn
                FROM "chats"
            )
            DELETE FROM "chats" WHERE id IN (SELECT id FROM RankedChats WHERE rn > 1);
        `);

        console.log('Backfill complete!');
    } catch (e) {
        console.error('Error during backfill', e);
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
