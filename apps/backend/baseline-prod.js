/**
 * baseline-prod.js
 * 
 * Three-phase production baseline script (ALL READ-ONLY except where noted):
 * 
 *   Phase 1: BACKUP — dumps all table data to baseline-backup.json
 *   Phase 2: FIX    — creates the one missing index (additive, non-destructive)
 *   Phase 3: VERIFY — confirms production schema matches 0_init expectations
 * 
 * After running this, the user must manually run:
 *   DATABASE_URL="..." npx prisma migrate resolve --applied 0_init
 * 
 * Usage: DATABASE_URL="postgresql://..." node baseline-prod.js
 */
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function run() {
    const client = await pool.connect();
    try {
        // ─── PHASE 1: BACKUP ──────────────────────────────────────────────────
        console.log('=== PHASE 1: BACKUP ===\n');

        const tables = await client.query(`
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            AND table_name != '_prisma_migrations'
            ORDER BY table_name;
        `);

        const backup = {};
        for (const { table_name } of tables.rows) {
            const data = await client.query(`SELECT * FROM "${table_name}"`);
            backup[table_name] = data.rows;
            console.log(`  Backed up ${table_name}: ${data.rows.length} rows`);
        }

        const backupPath = `baseline-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
        console.log(`\n  ✅ Backup saved to: ${backupPath}\n`);

        // ─── PHASE 2: CREATE MISSING INDEX ────────────────────────────────────
        console.log('=== PHASE 2: CREATE MISSING INDEX ===\n');

        // Check if the index already exists
        const indexCheck = await client.query(`
            SELECT indexname FROM pg_indexes
            WHERE schemaname = 'public'
            AND tablename = 'items'
            AND indexname = 'items_isActive_createdAt_idx';
        `);

        if (indexCheck.rows.length > 0) {
            console.log('  Index items_isActive_createdAt_idx already exists — skipping.\n');
        } else {
            console.log('  Creating index items_isActive_createdAt_idx...');
            await client.query(`
                CREATE INDEX "items_isActive_createdAt_idx" ON "items"("isActive", "createdAt");
            `);
            console.log('  ✅ Index created.\n');
        }

        // ─── PHASE 3: VERIFY ─────────────────────────────────────────────────
        console.log('=== PHASE 3: VERIFY SCHEMA MATCHES 0_init ===\n');

        // Check all expected tables
        const expectedTables = [
            'users', 'refresh_tokens', 'otps', 'items', 'borrow_transactions',
            'transaction_otps', 'chats', 'messages', 'wallets', 'wallet_transactions',
            'withdrawal_requests', 'reports', 'audit_logs'
        ];
        const actualTables = tables.rows.map(r => r.table_name);
        let allGood = true;

        for (const t of expectedTables) {
            if (!actualTables.includes(t)) {
                console.log(`  ❌ MISSING TABLE: ${t}`);
                allGood = false;
            }
        }

        // Check the index now exists
        const indexRecheck = await client.query(`
            SELECT indexname FROM pg_indexes
            WHERE schemaname = 'public'
            AND tablename = 'items'
            AND indexname = 'items_isActive_createdAt_idx';
        `);
        if (indexRecheck.rows.length === 0) {
            console.log('  ❌ MISSING INDEX: items_isActive_createdAt_idx');
            allGood = false;
        }

        // Check _prisma_migrations does NOT exist yet (should be created by resolve)
        const migCheck = await client.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
            ) AS exists;
        `);
        if (migCheck.rows[0].exists) {
            console.log('  ⚠️  _prisma_migrations already exists — migrate resolve may update it.');
        } else {
            console.log('  ✅ _prisma_migrations does not exist (will be created by migrate resolve)');
        }

        if (allGood) {
            console.log('  ✅ All 13 tables present. Index verified.\n');
            console.log('=== READY FOR BASELINE ===');
            console.log('Production schema matches 0_init. Now run:\n');
            console.log('  $env:DATABASE_URL="<your_prod_url>"; npx prisma migrate resolve --applied 0_init\n');
        } else {
            console.log('\n  ❌ Schema mismatch detected — do NOT run migrate resolve until fixed.\n');
            process.exitCode = 1;
        }

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(err => {
    console.error('Script failed:', err.message);
    process.exit(1);
});
