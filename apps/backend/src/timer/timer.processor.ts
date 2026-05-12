import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionStatus } from '@prisma/client';
import { TIMER_QUEUE, GRACE_JOB, LATE_JOB } from '../borrow/borrow.service';

@Processor(TIMER_QUEUE)
export class TimerProcessor {
    private readonly logger = new Logger(TimerProcessor.name);

    constructor(private prisma: PrismaService) { }

    // ─── ACTIVE → GRACE ─────────────────────────────────────────────────────

    @Process(GRACE_JOB)
    async handleGrace(job: Job<{ transactionId: string }>) {
        const { transactionId } = job.data;
        this.logger.log(`[GRACE] Processing job for transaction ${transactionId}`);

        const tx = await this.prisma.borrowTransaction.findUnique({
            where: { id: transactionId },
        });

        if (!tx) {
            this.logger.warn(`[GRACE] Transaction ${transactionId} not found`);
            return;
        }

        // Idempotent: only transition if still ACTIVE
        if (tx.status !== TransactionStatus.ACTIVE) {
            this.logger.log(`[GRACE] Transaction ${transactionId} already in ${tx.status}, skipping`);
            return;
        }

        await this.prisma.borrowTransaction.update({
            where: { id: transactionId },
            data: { status: TransactionStatus.GRACE },
        });

        this.logger.log(`[GRACE] Transaction ${transactionId} transitioned to GRACE`);
    }

    // ─── GRACE → LATE ───────────────────────────────────────────────────────

    @Process(LATE_JOB)
    async handleLate(job: Job<{ transactionId: string }>) {
        const { transactionId } = job.data;
        this.logger.log(`[LATE] Processing job for transaction ${transactionId}`);

        const tx = await this.prisma.borrowTransaction.findUnique({
            where: { id: transactionId },
        });

        if (!tx) {
            this.logger.warn(`[LATE] Transaction ${transactionId} not found`);
            return;
        }

        // Idempotent: only transition if GRACE or ACTIVE (edge case)
        if (!['ACTIVE', 'GRACE'].includes(tx.status)) {
            this.logger.log(`[LATE] Transaction ${transactionId} already in ${tx.status}, skipping`);
            return;
        }

        await this.prisma.borrowTransaction.update({
            where: { id: transactionId },
            data: { status: TransactionStatus.LATE },
        });

        this.logger.log(`[LATE] Transaction ${transactionId} transitioned to LATE`);
    }

    // ─── Error Handling ──────────────────────────────────────────────────────

    @OnQueueFailed()
    async onFailed(job: Job, error: Error) {
        this.logger.error(
            `Timer job failed: ${job.name} | transactionId: ${job.data?.transactionId} | Error: ${error.message}`,
        );
    }
}
