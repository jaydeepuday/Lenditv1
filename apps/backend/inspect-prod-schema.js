/**
 * inspect-prod-schema.js
 * 
 * READ-ONLY inspection of the production database.
 * Does NOT modify any data or schema.
 * 
 * Usage: DATABASE_URL="postgresql://..." node inspect-prod-schema.js
 *    or: set DATABASE_URL=postgresql://... && node inspect-prod-schema.js
 */
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function inspect() {
    const client = await pool.connect();
    try {
        console.log('=== 1. CHECK: _prisma_migrations TABLE ===\n');
        const migTableCheck = await client.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = '_prisma_migrations'
            ) AS exists;
        `);
        const hasMigTable = migTableCheck.rows[0].exists;
        console.log('_prisma_migrations exists:', hasMigTable);

        if (hasMigTable) {
            const migRecords = await client.query(`
                SELECT id, migration_name, finished_at, applied_steps_count
                FROM _prisma_migrations
                ORDER BY started_at;
            `);
            console.log('\nMigration records:');
            if (migRecords.rows.length === 0) {
                console.log('  (empty — no migrations recorded)');
            } else {
                migRecords.rows.forEach(r => {
                    console.log(`  - ${r.migration_name} | applied_steps: ${r.applied_steps_count} | finished: ${r.finished_at}`);
                });
            }
        }

        console.log('\n=== 2. ALL TABLES IN public SCHEMA ===\n');
        const tables = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        `);
        tables.rows.forEach(r => console.log('  -', r.table_name));

        console.log('\n=== 3. ALL ENUMS ===\n');
        const enums = await client.query(`
            SELECT t.typname AS enum_name,
                   string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS values
            FROM pg_type t
            JOIN pg_enum e ON t.oid = e.enumtypid
            JOIN pg_namespace n ON t.typnamespace = n.oid
            WHERE n.nspname = 'public'
            GROUP BY t.typname
            ORDER BY t.typname;
        `);
        enums.rows.forEach(r => console.log(`  ${r.enum_name}: [${r.values}]`));

        console.log('\n=== 4. COLUMNS PER TABLE ===\n');
        for (const tbl of tables.rows) {
            if (tbl.table_name === '_prisma_migrations') continue;
            const cols = await client.query(`
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_schema = 'public'
                AND table_name = $1
                ORDER BY ordinal_position;
            `, [tbl.table_name]);
            console.log(`  [${tbl.table_name}]`);
            cols.rows.forEach(c => {
                console.log(`    ${c.column_name} | ${c.data_type} | nullable: ${c.is_nullable} | default: ${c.column_default || 'none'}`);
            });
            console.log();
        }

        console.log('=== 5. INDEXES ===\n');
        const indexes = await client.query(`
            SELECT tablename, indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = 'public'
            AND tablename != '_prisma_migrations'
            ORDER BY tablename, indexname;
        `);
        indexes.rows.forEach(r => console.log(`  [${r.tablename}] ${r.indexname}`));

        console.log('\n=== 6. ROW COUNTS (data survival check) ===\n');
        for (const tbl of tables.rows) {
            if (tbl.table_name === '_prisma_migrations') continue;
            const count = await client.query(`SELECT COUNT(*) AS cnt FROM "${tbl.table_name}"`);
            console.log(`  ${tbl.table_name}: ${count.rows[0].cnt} rows`);
        }

    } finally {
        client.release();
        await pool.end();
    }
}

inspect().catch(err => {
    console.error('Inspection failed:', err.message);
    process.exit(1);
});
