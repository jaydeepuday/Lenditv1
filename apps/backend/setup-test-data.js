const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/lendit_db?schema=public' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function run() {
    console.log("=== DB SEED SCRIPT START ===");
    try {
        console.log("1. Tearing down old test data...");
        // Raw SQL to aggressively bypass Prisma cascade limitations if any
        await prisma.$executeRaw`DELETE FROM "messages" WHERE "senderId" IN (SELECT id FROM "users" WHERE email LIKE 'test_%')`;
        await prisma.$executeRaw`DELETE FROM "chats" WHERE "renterId" IN (SELECT id FROM "users" WHERE email LIKE 'test_%') OR "lenderId" IN (SELECT id FROM "users" WHERE email LIKE 'test_%')`;
        await prisma.$executeRaw`DELETE FROM "transaction_otps" WHERE "transactionId" IN (SELECT id FROM "borrow_transactions" WHERE "renterId" IN (SELECT id FROM "users" WHERE email LIKE 'test_%') OR "lenderId" IN (SELECT id FROM "users" WHERE email LIKE 'test_%'))`;
        await prisma.$executeRaw`DELETE FROM "borrow_transactions" WHERE "renterId" IN (SELECT id FROM "users" WHERE email LIKE 'test_%') OR "lenderId" IN (SELECT id FROM "users" WHERE email LIKE 'test_%')`;
        await prisma.$executeRaw`DELETE FROM "wallet_transactions" WHERE "walletId" IN (SELECT id FROM "wallets" WHERE "userId" IN (SELECT id FROM "users" WHERE email LIKE 'test_%'))`;
        await prisma.$executeRaw`DELETE FROM "withdrawal_requests" WHERE "walletId" IN (SELECT id FROM "wallets" WHERE "userId" IN (SELECT id FROM "users" WHERE email LIKE 'test_%'))`;
        await prisma.$executeRaw`DELETE FROM "wallets" WHERE "userId" IN (SELECT id FROM "users" WHERE email LIKE 'test_%')`;
        await prisma.$executeRaw`DELETE FROM "items" WHERE "ownerId" IN (SELECT id FROM "users" WHERE email LIKE 'test_%')`;
        await prisma.$executeRaw`DELETE FROM "users" WHERE email LIKE 'test_%'`;

        console.log("2. Generating test users...");
        const passwordHash = await bcrypt.hash('Password123!', 10);

        let outputData = {
            lender: null,
            renters: [], // [{ email, password, itemToRent }]
            items: []
        };

        // Create 1 Lender
        const lender = await prisma.user.create({
            data: {
                name: 'Test Lender',
                email: 'test_lender_1@lendit.local',
                passwordHash,
                college: 'Woxsen University',
                isVerified: true,
                wallet: { create: { balance: 0 } }
            }
        });
        outputData.lender = { email: lender.email, password: 'Password123!' };
        console.log("-> Created Lender:", lender.email);

        console.log("3. Creating thousands of Renters & Isolated Items (1-to-1 Mapping) for K6 Looping...");

        // We will seed 2000 unique renters and 2000 items so K6 VUs can loop continuously.
        const numVUs = 2000;

        const rentersData = [];
        const walletsData = [];
        const itemsData = [];
        const crypto = require('crypto');

        for (let i = 1; i <= numVUs; i++) {
            const userId = crypto.randomUUID();
            const itemId = crypto.randomUUID();

            rentersData.push({
                id: userId,
                name: `Test Renter ${i}`,
                email: `test_renter_${i}@lendit.local`,
                passwordHash,
                college: 'Woxsen University',
                isVerified: true,
            });

            walletsData.push({
                userId: userId,
                balance: 10000.00
            });

            itemsData.push({
                id: itemId,
                ownerId: lender.id,
                title: `Test Item ${i} exclusively for sequence ${i}`,
                description: `A unique test item guaranteed to not suffer overlapping bookings.`,
                category: 'ELECTRONICS',
                images: [],
                pricePerHour: 50,
                pricePerDay: 200,
                maxHours: 12,
                isAvailable: true,
                isActive: true,
            });

            outputData.renters.push({
                email: `test_renter_${i}@lendit.local`,
                password: 'Password123!',
                allocatedItemId: itemId
            });
        }

        console.log("-> Executing bulk inserts...");
        await prisma.user.createMany({ data: rentersData });
        await prisma.wallet.createMany({ data: walletsData });
        await prisma.item.createMany({ data: itemsData });

        console.log(`-> Successfully seeded ${numVUs} isolated test allocations.`);

        // 5. Generate Test JWT Tokens directly to bypass login 5 req/min @Throttle
        const jwt = require('jsonwebtoken');
        const jwtSecret = process.env.JWT_ACCESS_SECRET || 'lendit_access_secret_dev_change_in_prod_minimum_32_chars';

        outputData.lender = {
            id: lender.id,
            email: lender.email,
            token: jwt.sign({ sub: lender.id, email: lender.email, role: 'USER' }, jwtSecret, { expiresIn: '1d' })
        };

        for (let i = 0; i < numVUs; i++) {
            const r = rentersData[i];
            outputData.renters[i].token = jwt.sign({ sub: r.id, email: r.email, role: 'USER' }, jwtSecret, { expiresIn: '1d' });
            delete outputData.renters[i].password;
        }

        const outputPath = path.join(__dirname, '../../load-tests/phase2-data.json');
        fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
        console.log(`\n4. Data written successfully to phase2-data.json`);

    } catch (err) {
        console.error("Setup Script Failed:", err);
        process.exit(1);
    }
    console.log("=== DB SEED SCRIPT END ===");
    process.exit(0);
}
run();
