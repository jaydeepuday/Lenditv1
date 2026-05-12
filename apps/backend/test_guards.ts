import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { BorrowService } from './src/borrow/borrow.service';
import { PrismaService } from './src/prisma/prisma.service';
import { TransactionStatus, DurationType, RentalType, Role } from '@prisma/client';
import { Logger } from '@nestjs/common';

async function main() {
    const logger = new Logger('TestGuards');
    logger.log('Booting Application Context for System Tests...');
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const borrowService = app.get(BorrowService);
    const prisma = app.get(PrismaService);

    // Setup Test Data
    const uniqueSuffix = Date.now();
    const renter = await prisma.user.create({
        data: { email: `mock_renter_${uniqueSuffix}@woxsen.edu.in`, name: 'Mock Renter', passwordHash: 'hash', college: 'Woxsen', isVerified: true, role: Role.USER }
    });
    const lender = await prisma.user.create({
        data: { email: `mock_lender_${uniqueSuffix}@woxsen.edu.in`, name: 'Mock Lender', passwordHash: 'hash', college: 'Woxsen', isVerified: true, role: Role.USER }
    });
    const renterWallet = await prisma.wallet.create({ data: { userId: renter.id, balance: 5000, holdBalance: 0 } });
    const lenderWallet = await prisma.wallet.create({ data: { userId: lender.id, balance: 1000, holdBalance: 0 } });
    const item = await prisma.item.create({
        data: { title: 'Test DSLR', category: 'TECH', description: 'Test', pricePerHour: 100, pricePerDay: 500, ownerId: lender.id, images: [] }
    });

    const createMockCheckout = async (modifier: (tx: any) => any = (t) => t) => {
        let tx = await prisma.borrowTransaction.create({
            data: {
                renterId: renter.id, lenderId: lender.id, itemId: item.id,
                status: TransactionStatus.PAYMENT_PENDING, paymentStatus: 'PENDING',
                durationType: DurationType.HOURS, durationValue: 2, rentAmount: 200, renterFee: 20, lenderFee: 0,
                totalPaid: 220, lenderPayout: 200, platformEarned: 20,
                paymentStartedAt: new Date(), escrowHeld: false, rentalType: RentalType.QUICK
            }
        });
        await prisma.wallet.update({ where: { id: renterWallet.id }, data: { holdBalance: { increment: 220 } } });
        await prisma.walletTransaction.create({
            data: { walletId: renterWallet.id, type: 'HOLD', amount: 220, balanceAfter: 5000, description: 'Test Hold', borrowTxId: tx.id }
        });
        tx = modifier(tx);
        await prisma.borrowTransaction.update({ where: { id: tx.id }, data: tx });
        return tx;
    };

    try {
        console.log('\n🔥 TEST 1 — Expiry during payment');
        const tx1 = await createMockCheckout((t) => ({ ...t, paymentStartedAt: new Date(Date.now() - 15 * 60 * 1000) }));
        let caughtExpiry = false;
        try {
            await borrowService.processPayment(tx1.id, renter.id);
        } catch (e: any) {
            console.log(`[Caught Expected Exception]: ${e.message}`);
            if (e.message.includes('expired')) caughtExpiry = true;
        }
        const state1 = await prisma.borrowTransaction.findUnique({ where: { id: tx1.id } });
        const wallet1 = await prisma.wallet.findUnique({ where: { id: renterWallet.id } });
        console.log(`Test 1 Result: Status = ${state1?.status}, CaughtExpiry = ${caughtExpiry}, HoldBalance = ${wallet1?.holdBalance}`);

        console.log('\n🔥 TEST 2 — Double click pay (Race Condition Guard)');
        const tx2 = await createMockCheckout();
        const p1 = borrowService.processPayment(tx2.id, renter.id).catch(e => e.message);
        const p2 = borrowService.processPayment(tx2.id, renter.id).catch(e => e.message);
        const [res1, res2] = await Promise.all([p1, p2]);
        const state2 = await prisma.borrowTransaction.findUnique({ where: { id: tx2.id } });
        const debits = await prisma.walletTransaction.count({ where: { borrowTxId: tx2.id, type: 'DEBIT' } });
        console.log(`Test 2 Result: Successes/Fails: [${typeof res1 === 'string' ? res1 : 'OK'}, ${typeof res2 === 'string' ? res2 : 'OK'}], Debits = ${debits}`);

        console.log('\n🔥 TEST 3 — Cancel during checkout (Idempotency)');
        const tx3 = await createMockCheckout();
        await borrowService.cancelTransaction(tx3.id, renter.id);
        const state3 = await prisma.borrowTransaction.findUnique({ where: { id: tx3.id } });
        const release = await prisma.walletTransaction.findFirst({ where: { borrowTxId: tx3.id, type: 'RELEASE' } });
        console.log(`Test 3 Result: Status = ${state3?.status}, Released = ${!!release}`);

        console.log('\n🔥 TEST 4 — Simulate complete database rollback (Atomicity Check)');
        const wallet4Before = await prisma.wallet.findUnique({ where: { id: renterWallet.id } });
        let caughtNetwork = false;
        try {
            await prisma.$transaction(async (tx) => {
                await tx.wallet.update({ where: { id: renterWallet.id }, data: { balance: { decrement: 50000 } } }); // Massive debit
                throw new Error('Simulated Network Failure Mid-Tx');
            });
        } catch (e: any) {
            console.log(`[Caught Expected Exception]: ${e.message}`);
            caughtNetwork = true;
        }
        const wallet4After = await prisma.wallet.findUnique({ where: { id: renterWallet.id } });
        console.log(`Test 4 Result: Caught Fail = ${caughtNetwork}, Balance Stable = ${wallet4Before?.balance === wallet4After?.balance}`);

    } catch (e: any) {
        console.error(`Test execution failed: ${e.message}`);
    } finally {
        // Cleanup based on test entities
        await prisma.walletTransaction.deleteMany({ where: { walletId: { in: [renterWallet.id, lenderWallet.id] } }});
        await prisma.borrowTransaction.deleteMany({ where: { renterId: renter.id } });
        await prisma.item.deleteMany({ where: { ownerId: lender.id } });
        await prisma.wallet.deleteMany({ where: { userId: { in: [renter.id, lender.id] } } });
        await prisma.user.deleteMany({ where: { id: { in: [renter.id, lender.id] } } });
        await app.close();
        console.log('\nTests complete. Mocks cleaned up.');
    }
}

main().catch(console.error);
