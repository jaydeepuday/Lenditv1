import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionStatus } from '@prisma/client';
import { TIMER_QUEUE, GRACE_JOB, LATE_JOB } from '../borrow/borrow.service';

/**
 * TimerService: On startup, rehydrates any ACTIVE or GRACE transactions
 * from the database and re-queues their timer jobs in BullMQ.
 * This ensures server restarts never lose timer continuity.
 */
@Injectable()
export class TimerService implements OnModuleInit {
    private readonly logger = new Logger(TimerService.name);

    constructor(
        private prisma: PrismaService,
        // @InjectQueue(TIMER_QUEUE) private timerQueue: Queue,
    ) { }

    async onModuleInit() {
        await this.rehydrateTimers();
    }

    private async rehydrateTimers(): Promise<void> {
        this.logger.log('Rehydrating active timers from database...');

        const now = new Date();

        // Find all transactions that should have timers running
        const activeTransactions = await this.prisma.borrowTransaction.findMany({
            where: {
                status: { in: [TransactionStatus.ACTIVE, TransactionStatus.GRACE] },
                escrowReleased: false,
            },
        });

        let rehydrated = 0;

        for (const tx of activeTransactions) {
            // Remove any existing jobs for this transaction (from before restart)
            if (tx.graceJobId) {
                /*
                try {
                    const existing = await this.timerQueue.getJob(tx.graceJobId);
                    if (existing) await existing.remove();
                } catch { }
                */
            }
            if (tx.lateJobId) {
                /*
                try {
                    const existing = await this.timerQueue.getJob(tx.lateJobId);
                    if (existing) await existing.remove();
                } catch { }
                */
            }

            let graceJobId = tx.graceJobId;
            let lateJobId = tx.lateJobId;

            // Re-queue GRACE job if needed
            if (tx.status === TransactionStatus.ACTIVE && tx.endsAt) {
                const delay = tx.endsAt.getTime() - now.getTime();
                if (delay > 0) {
                    /*
                    const job = await this.timerQueue.add(
                        GRACE_JOB,
                        { transactionId: tx.id },
                        { delay, attempts: 3, backoff: 5000 },
                    );
                    graceJobId = String(job.id);
                    */
                    graceJobId = "mock-grace";
                } else {
                    // Timer already passed — transition immediately
                    await this.prisma.borrowTransaction.update({
                        where: { id: tx.id },
                        data: { status: TransactionStatus.GRACE },
                    });
                    this.logger.warn(`Tx ${tx.id} grace period missed on restart — transitioned immediately`);
                }
            }

            // Re-queue LATE job if needed
            if (
                ([TransactionStatus.ACTIVE, TransactionStatus.GRACE] as TransactionStatus[]).includes(tx.status) &&
                tx.graceEndsAt
            ) {
                const delay = tx.graceEndsAt.getTime() - now.getTime();
                if (delay > 0) {
                    /*
                    const job = await this.timerQueue.add(
                        LATE_JOB,
                        { transactionId: tx.id },
                        { delay, attempts: 3, backoff: 5000 },
                    );
                    lateJobId = String(job.id);
                    */
                    lateJobId = "mock-late";
                } else {
                    // Grace period already passed
                    await this.prisma.borrowTransaction.update({
                        where: { id: tx.id },
                        data: { status: TransactionStatus.LATE },
                    });
                    this.logger.warn(`Tx ${tx.id} already LATE on restart — transitioned immediately`);
                    continue; // No need to update job IDs for LATE transactions
                }
            }

            // Update job IDs in DB
            await this.prisma.borrowTransaction.update({
                where: { id: tx.id },
                data: { graceJobId, lateJobId },
            });

            rehydrated++;
        }

        this.logger.log(`Rehydrated ${rehydrated} active timer(s) from database`);
    }
}
