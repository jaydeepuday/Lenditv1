const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/lendit_db?schema=public' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function run() {
    const txs = await prisma.borrowTransaction.findMany();
    console.log(`Total transactions in DB: ${txs.length}`);
    if (txs.length > 0) {
        require('fs').writeFileSync('tx-details.json', JSON.stringify(txs[0], null, 2));
    }
    process.exit(0);
}
run();
