const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/lendit_db?schema=public' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function verify() {
    console.log("=== DB INVARIANT VERIFICATION ===");
    try {
        const totalTx = await prisma.borrowTransaction.count();
        const paidTx = await prisma.borrowTransaction.count({ where: { status: 'PAID' } });
        const pendingPaymentTx = await prisma.borrowTransaction.count({ where: { paymentStatus: 'PAID' } });

        console.log(`- Total BorrowTransactions: ${totalTx}`);
        console.log(`- Fully PAID status workflows: ${paidTx}`);
        console.log(`- Workflows with paymentStatus = 'PAID': ${pendingPaymentTx}`);

        const negativeWallets = await prisma.wallet.count({ where: { balance: { lt: 0 } } });
        console.log(`- Wallets with negative balances: ${negativeWallets}`);

        const holds = await prisma.walletTransaction.count({ where: { type: 'HOLD' } });
        const debits = await prisma.walletTransaction.count({ where: { type: 'DEBIT' } });
        console.log(`- Total HOLD / DEBIT records created: ${holds} HOLDs, ${debits} DEBITs`);

        const duplicateTxIds = await prisma.$queryRaw`
            SELECT "borrowTxId", COUNT(*) as count 
            FROM "wallet_transactions" 
            WHERE type = 'DEBIT' 
            GROUP BY "borrowTxId" 
            HAVING COUNT(*) > 1
        `;
        console.log(`- Duplicate DEBITs per transaction: ${duplicateTxIds.length}`);

        const corruptedTx = await prisma.borrowTransaction.count({
            where: {
                status: 'PAID',
                escrowHeld: false
            }
        });
        console.log(`- State corruption check (PAID but escrowHeld=false): ${corruptedTx}`);

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
verify();
