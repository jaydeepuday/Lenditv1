import {
    Injectable,
    BadRequestException,
    NotFoundException,
    ForbiddenException,
    ConflictException,
    Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { RequestBorrowDto, AcceptBorrowDto } from './dto/borrow.dto';
import { TransactionStatus, DurationType, RentalType, WalletTransactionType, BorrowTransaction, Wallet } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../auth/email.service';
import { ChatGateway } from '../chat/chat.gateway'; 
import { EXAM_CONFIG } from '../config/exam.config';

const RENTER_FEE_RATE = 0.10; // 10%
const LENDER_FEE_RATE = 0;    // 0% (Used to be 5%)
const GRACE_PERIOD_MS = 60 * 60 * 1000; // 1 hour grace period
const TURNOVER_BUFFER_MS = 30 * 60 * 1000; // 30-minute soft buffer between bookings


export const TIMER_QUEUE = 'timer';
export const GRACE_JOB = 'start-grace';
export const LATE_JOB = 'mark-late';

@Injectable()
export class BorrowService {
    private readonly logger = new Logger(BorrowService.name);

    constructor(
        private prisma: PrismaService,
        private readonly configService: ConfigService,
        private readonly emailService: EmailService,
        private chatGateway: ChatGateway, // Injected ChatGateway
        // @InjectQueue(TIMER_QUEUE) private readonly timerQueue: Queue,
    ) { }

    private validateTransition(current: string, next: string) {
        const allowedTransitions: Record<string, string[]> = {
            REQUESTED: ["ACCEPTED", "REJECTED", "CANCELLED"],
            ACCEPTED: ["PAYMENT_PENDING", "PAID", "CANCELLED"],
            PAYMENT_PENDING: ["PAID", "CANCELLED", "ACCEPTED"],
            PAID: ["ACTIVE", "CANCELLED"],
            ACTIVE: ["RETURNED", "LATE"],
        };

        const allowed = allowedTransitions[current];

        if (!allowed || !allowed.includes(next)) {
            throw new BadRequestException(
                `Invalid state transition from ${current} to ${next}`
            );
        }
    }

    // ─── 1. Request Borrow ──────────────────────────────────────────────────

    async requestBorrow(renterId: string, dto: RequestBorrowDto) {
        return this.prisma.$transaction(async (tx) => {

            // ── Preset Rental Mode (QUICK / EXAM_PASS) ───────────────────────
            // When rentalType is supplied we override times and pricing.
            // The rest of the function (conflict check, tx.create) runs as-is.
            let presetFinalPrice: number | null = null;
            let presetPlatformFee: number | null = null;
            let presetReqStart: Date | null = null;
            let presetReqEnd: Date | null = null;

            if (dto.rentalType === RentalType.QUICK) {
                presetReqStart    = new Date();                                              // now
                presetReqEnd      = new Date(Date.now() + EXAM_CONFIG.quickRentMaxHours * 60 * 60 * 1000);
                presetFinalPrice  = EXAM_CONFIG.prices.QUICK;
                presetPlatformFee = Math.ceil(presetFinalPrice * 0.1);

            } else if (dto.rentalType === RentalType.EXAM_PASS) {
                // Exam dates are derived directly from config, not user input!
                presetReqStart = new Date(EXAM_CONFIG.examStart);
                presetReqEnd   = new Date(EXAM_CONFIG.examEnd);
                if (isNaN(presetReqStart.getTime()) || isNaN(presetReqEnd.getTime())) {
                    throw new BadRequestException('EXAM_PASS dates misconfigured on server');
                }
                if (presetReqStart >= presetReqEnd) {
                    throw new BadRequestException('Exam config end must be after start');
                }
                presetFinalPrice  = EXAM_CONFIG.prices.EXAM_PASS;
                presetPlatformFee = Math.ceil(presetFinalPrice * 0.1);
            }

            // ── Standard date validation (skip for presets where start = now) ─
            const isPresetMode = presetReqStart !== null;

            const reqStart = isPresetMode ? presetReqStart! : new Date(dto.requestedStartTime ?? '');
            const reqEnd   = isPresetMode ? presetReqEnd!   : new Date(dto.requestedEndTime   ?? '');

            if (!isPresetMode) {
                if (isNaN(reqStart.getTime()) || isNaN(reqEnd.getTime())) {
                    throw new BadRequestException('Invalid date format');
                }
                if (reqStart <= new Date()) {
                    throw new BadRequestException('Start time must be in the future');
                }
                if (reqStart >= reqEnd) {
                    throw new BadRequestException('End time must be after start time');
                }
            }

            // ── Item lookup (unchanged) ──────────────────────────────────────
            const item = await tx.item.findUnique({
                where: { id: dto.itemId },
                select: { id: true, ownerId: true, isAvailable: true, pricePerHour: true, pricePerDay: true },
            });

            if (!item) throw new NotFoundException('Item not found');
            if (item.ownerId === renterId) throw new ForbiddenException('You cannot borrow your own item');

            // RATE LIMIT (Anti-Spam)
            const sixtySecondsAgo = new Date(Date.now() - 60 * 1000);
            const recentRequests = await tx.borrowTransaction.count({
                where: { renterId, createdAt: { gt: sixtySecondsAgo } }
            });
            if (recentRequests >= 5) {
                throw new BadRequestException('Too many requests, slow down');
            }

            // ACTIVE REQUEST LIMIT: max 2 pending requests per renter
            const activeRequestCount = await tx.borrowTransaction.count({
                where: {
                    renterId,
                    status: { in: [TransactionStatus.REQUESTED, TransactionStatus.ACCEPTED] },
                },
            });
            if (activeRequestCount >= 2) {
                throw new BadRequestException('Too many active requests. Complete or cancel an existing one first.');
            }

            // AUTO-EXPIRY: Clean up any stale ACCEPTED or PAYMENT_PENDING requests first!
            const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
            const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);

            await tx.borrowTransaction.updateMany({
                where: {
                    itemId: item.id,
                    status: TransactionStatus.ACCEPTED,
                    escrowHeld: false,
                    acceptedAt: { lt: fifteenMinsAgo }
                },
                data: { status: 'CANCELLED' as any }
            });

            await tx.borrowTransaction.updateMany({
                where: {
                    itemId: item.id,
                    status: TransactionStatus.PAYMENT_PENDING,
                    escrowHeld: false,
                    paymentStartedAt: { lt: tenMinsAgo }
                },
                data: { status: 'CANCELLED' as any }
            });

            // CONFLICT CHECK (runs for both preset and standard)
            const conflicts = await tx.borrowTransaction.findFirst({
                where: {
                    itemId: item.id,
                    status: { in: [TransactionStatus.REQUESTED, TransactionStatus.ACCEPTED, TransactionStatus.PAYMENT_PENDING, TransactionStatus.PAID, TransactionStatus.ACTIVE, TransactionStatus.GRACE, TransactionStatus.LATE] },
                    requestedStartTime: { lt: reqEnd },
                    requestedEndTime: { gt: reqStart }
                }
            });

            if (conflicts) throw new ConflictException('This time slot overlaps with an existing booking.');

            // ── Soft Buffer / Tight Turnover Check (bidirectional) ────────────
            const [previousBooking, nextBooking] = await Promise.all([
                tx.borrowTransaction.findFirst({
                    where: {
                        itemId: item.id,
                        status: { in: ['ACCEPTED', 'PAID', 'ACTIVE', 'GRACE', 'LATE'] },
                        requestedEndTime: { lte: reqStart },
                    },
                    orderBy: { requestedEndTime: 'desc' },
                }),
                tx.borrowTransaction.findFirst({
                    where: {
                        itemId: item.id,
                        status: { in: ['ACCEPTED', 'PAID', 'ACTIVE', 'GRACE', 'LATE'] },
                        requestedStartTime: { gte: reqEnd },
                    },
                    orderBy: { requestedStartTime: 'asc' },
                }),
            ]);

            let isTightTurnover = false;
            let isVeryTight = false;
            let tightSide: 'previous' | 'next' | 'both' | null = null;
            let prevTimeStr = '';
            let nextTimeStr = '';

            const formatTime = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

            if (previousBooking?.requestedEndTime) {
                const gapBefore = reqStart.getTime() - previousBooking.requestedEndTime.getTime();
                if (gapBefore < TURNOVER_BUFFER_MS) { 
                    isTightTurnover = true;
                    tightSide = 'previous'; 
                    if (gapBefore < 10 * 60 * 1000) isVeryTight = true;
                    prevTimeStr = formatTime(previousBooking.requestedEndTime);
                }
            }
            if (nextBooking?.requestedStartTime) {
                const gapAfter = nextBooking.requestedStartTime.getTime() - reqEnd.getTime();
                if (gapAfter < TURNOVER_BUFFER_MS) {
                    isTightTurnover = true;
                    tightSide = tightSide === 'previous' ? 'both' : 'next';
                    if (gapAfter < 10 * 60 * 1000) isVeryTight = true;
                    nextTimeStr = formatTime(nextBooking.requestedStartTime);
                }
            }

            let warningObj = null;
            if (isTightTurnover) {
                const showUIBox = tightSide === 'both' || isVeryTight;
                let color = '#d97706'; let bg = '#fef3c7'; let border = '#fcd34d'; // yellow
                if (tightSide === 'both') {
                    color = '#b91c1c'; bg = '#fee2e2'; border = '#fca5a5'; // red
                } else if (tightSide === 'next') {
                    color = '#c2410c'; bg = '#ffedd5'; border = '#fdba74'; // orange
                }
                
                let message = '';
                if (tightSide === 'previous') message = `⚠️ Previous booking ends at ${prevTimeStr} — pickup may be delayed`;
                else if (tightSide === 'next') message = `⚠️ Next booking starts at ${nextTimeStr} — please return on time`;
                else message = `⚠️ Tight schedule between ${prevTimeStr} and ${nextTimeStr} — be on time for pickup & return`;

                warningObj = { side: tightSide, showUIBox, color, bg, border, message, shortText: 'May be a slight delay' };
            }

            let rentAmount: number;
            let renterFee: number;
            let lenderFee: number;
            let totalPaid: number;
            let lenderPayout: number;
            let platformEarned: number;
            let activeDurationType: DurationType;
            let activeDurationValue: number;

            if (isPresetMode) {
                // ── Preset pricing path ──────────────────────────────────────
                //   renter pays: finalPrice + platformFee
                //   lender gets: finalPrice  (no deduction)
                //   platform:    platformFee only
                const fp  = presetFinalPrice!;
                const pf  = presetPlatformFee!;

                rentAmount      = fp;
                renterFee       = pf;
                lenderFee       = 0;
                totalPaid       = parseFloat((fp + pf).toFixed(2));
                lenderPayout    = parseFloat(fp.toFixed(2));
                platformEarned  = parseFloat(pf.toFixed(2));

                const durationMs   = reqEnd.getTime() - reqStart.getTime();
                const totalHours   = Math.ceil(durationMs / (1000 * 60 * 60));
                activeDurationType = DurationType.HOURS;
                activeDurationValue = totalHours;

            } else {
                // ── Standard hourly / daily pricing path (UNCHANGED) ─────────
                const durationMs = reqEnd.getTime() - reqStart.getTime();
                const totalHours = Math.ceil(durationMs / (1000 * 60 * 60));

                let baseRent = 0;
                if (item.pricePerDay && item.pricePerHour) {
                    const days = Math.floor(totalHours / 24);
                    const remHours = totalHours % 24;
                    const costCombo = (days * item.pricePerDay) + (remHours * item.pricePerHour);
                    const costDays = (days + 1) * item.pricePerDay;
                    baseRent = Math.min(costCombo, costDays);
                } else if (item.pricePerDay) {
                    baseRent = Math.ceil(totalHours / 24) * item.pricePerDay;
                } else if (item.pricePerHour) {
                    baseRent = totalHours * item.pricePerHour;
                } else {
                    throw new BadRequestException('Item has no pricing defined');
                }

                rentAmount      = baseRent;
                renterFee       = parseFloat((baseRent * RENTER_FEE_RATE).toFixed(2));
                lenderFee       = parseFloat((baseRent * LENDER_FEE_RATE).toFixed(2));
                totalPaid       = parseFloat((baseRent + renterFee).toFixed(2));
                lenderPayout    = parseFloat((baseRent - lenderFee).toFixed(2));
                platformEarned  = parseFloat((renterFee + lenderFee).toFixed(2));

                activeDurationType  = item.pricePerDay ? DurationType.DAYS : DurationType.HOURS;
                activeDurationValue = Math.ceil(totalHours / (item.pricePerDay ? 24 : 1));
            }

            const transaction = await tx.borrowTransaction.create({
                data: {
                    itemId: dto.itemId,
                    renterId,
                    lenderId: item.ownerId,
                    // Preset fields (null for standard rentals)
                    rentalType:  dto.rentalType ?? null,
                    finalPrice:  isPresetMode ? presetFinalPrice  : null,
                    platformFee: isPresetMode ? presetPlatformFee : null,
                    // Duration
                    durationType:  activeDurationType,
                    durationValue: activeDurationValue,
                    // Times
                    requestedStartTime: reqStart,
                    requestedEndTime:   reqEnd,
                    // Financials
                    rentAmount,
                    renterFee,
                    lenderFee,
                    totalPaid,
                    lenderPayout,
                    platformEarned,
                    status: TransactionStatus.REQUESTED,
                    pickupLocation: dto.pickupLocation,
                    returnLocation: dto.returnLocation,
                    isTightTurnover,
                },
                include: {
                    item:   { select: { id: true, title: true } },
                    renter: { select: { id: true, name: true } },
                    lender: { select: { id: true, name: true } },
                },
            });

            this.logger.log(
                isPresetMode
                    ? `User ${renterId} requested ${dto.rentalType} rental for item ${dto.itemId}. Total: ₹${totalPaid}`
                    : `User ${renterId} requested to borrow item ${dto.itemId}. Total: ₹${totalPaid}`
            );
            if (isTightTurnover) {
                this.logger.warn(`Tight turnover (${tightSide}) for item ${item.id} — gap < 30 min`);
            }

            // Return transaction + optional soft warning (never blocks the booking)
            return {
                ...transaction,
                ...(warningObj && { warning: warningObj }),
            };
        });
    }

    // ─── 1.5 Check Turnover Warning (Before Booking) ────────────────────────

    async checkTurnover(dto: RequestBorrowDto) {
        let presetReqStart: Date | null = null;
        let presetReqEnd: Date | null = null;
        
        if (dto.rentalType === RentalType.QUICK) {
            presetReqStart = new Date();
            presetReqEnd = new Date(Date.now() + EXAM_CONFIG.quickRentMaxHours * 60 * 60 * 1000);
        } else if (dto.rentalType === RentalType.EXAM_PASS) {
            presetReqStart = new Date(EXAM_CONFIG.examStart);
            presetReqEnd = new Date(EXAM_CONFIG.examEnd);
        }
        
        const isPresetMode = presetReqStart !== null;
        const reqStart = isPresetMode ? presetReqStart! : new Date(dto.requestedStartTime ?? '');
        const reqEnd   = isPresetMode ? presetReqEnd!   : new Date(dto.requestedEndTime   ?? '');

        if (isNaN(reqStart.getTime()) || isNaN(reqEnd.getTime())) {
            return { warning: null }; // Invalid dates; will fail creation anyway
        }

        const [previousBooking, nextBooking] = await Promise.all([
            this.prisma.borrowTransaction.findFirst({
                where: {
                    itemId: dto.itemId,
                    status: { in: ['ACCEPTED', 'PAID', 'ACTIVE', 'GRACE', 'LATE'] },
                    requestedEndTime: { lte: reqStart },
                },
                orderBy: { requestedEndTime: 'desc' },
            }),
            this.prisma.borrowTransaction.findFirst({
                where: {
                    itemId: dto.itemId,
                    status: { in: ['ACCEPTED', 'PAID', 'ACTIVE', 'GRACE', 'LATE'] },
                    requestedStartTime: { gte: reqEnd },
                },
                orderBy: { requestedStartTime: 'asc' },
            }),
        ]);

        let isTightTurnover = false;
        let isVeryTight = false;
        let tightSide: 'previous' | 'next' | 'both' | null = null;
        let prevTimeStr = '';
        let nextTimeStr = '';

        const formatTime = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

        if (previousBooking?.requestedEndTime) {
            const gapBefore = reqStart.getTime() - previousBooking.requestedEndTime.getTime();
            if (gapBefore < TURNOVER_BUFFER_MS) { 
                isTightTurnover = true;
                tightSide = 'previous'; 
                if (gapBefore < 10 * 60 * 1000) isVeryTight = true;
                prevTimeStr = formatTime(previousBooking.requestedEndTime);
            }
        }
        if (nextBooking?.requestedStartTime) {
            const gapAfter = nextBooking.requestedStartTime.getTime() - reqEnd.getTime();
            if (gapAfter < TURNOVER_BUFFER_MS) {
                isTightTurnover = true;
                tightSide = tightSide === 'previous' ? 'both' : 'next';
                if (gapAfter < 10 * 60 * 1000) isVeryTight = true;
                nextTimeStr = formatTime(nextBooking.requestedStartTime);
            }
        }

        if (!isTightTurnover) return { warning: null };

        const showUIBox = tightSide === 'both' || isVeryTight;
        let color = '#d97706'; let bg = '#fef3c7'; let border = '#fcd34d'; // yellow
        if (tightSide === 'both') {
            color = '#b91c1c'; bg = '#fee2e2'; border = '#fca5a5'; // red
        } else if (tightSide === 'next') {
            color = '#c2410c'; bg = '#ffedd5'; border = '#fdba74'; // orange
        }
        
        let message = '';
        if (tightSide === 'previous') message = `⚠️ Previous booking ends at ${prevTimeStr} — pickup may be delayed`;
        else if (tightSide === 'next') message = `⚠️ Next booking starts at ${nextTimeStr} — please return on time`;
        else message = `⚠️ Tight schedule between ${prevTimeStr} and ${nextTimeStr} — be on time for pickup & return`;

        return { 
            warning: { side: tightSide, showUIBox, color, bg, border, message, shortText: 'May be a slight delay' } 
        };
    }

    // ─── 2. Accept / Reject ─────────────────────────────────────────────────

    async respondToRequest(transactionId: string, lenderId: string, dto: AcceptBorrowDto) {
        const result = await this.prisma.$transaction(async (tx) => {
            const transaction = await tx.borrowTransaction.findUnique({
                where: { id: transactionId },
                include: { chat: true, renter: true, item: true },
            });

            if (!transaction) throw new NotFoundException('Transaction not found');
            if (transaction.lenderId !== lenderId) throw new ForbiddenException('Only the lender can respond to this request');
            if (transaction.status !== TransactionStatus.REQUESTED) {
                throw new BadRequestException(`Cannot respond to a transaction in ${transaction.status} status`);
            }

            if (dto.action === 'REJECTED') {
                return tx.borrowTransaction.update({
                    where: { id: transactionId },
                    data: { status: TransactionStatus.REJECTED },
                });
            }

            // ACCEPTED: Atomic State Update Guard
            const updateResult = await tx.borrowTransaction.updateMany({
                where: {
                    id: transactionId,
                    status: TransactionStatus.REQUESTED, // Prevent race conditions
                },
                data: {
                    status: TransactionStatus.ACCEPTED,
                    acceptedAt: new Date(),
                },
            });

            if (updateResult.count === 0) {
                throw new ConflictException('Transaction could not be accepted. It may have already changed state.');
            }

            // Create or unlock chat
            await tx.borrowTransaction.update({
                where: { id: transactionId },
                data: {}
            });

            if (transaction.chat) {
                await tx.chat.update({ where: { id: transaction.chat.id }, data: { isUnlocked: true } });
            } else {
                await tx.chat.create({ data: { transactionId, isUnlocked: true } });
            }

            this.logger.log(`Transaction ${transactionId} accepted by lender ${lenderId}`);

            // Send notification to renter
            this.emailService.sendNotificationEmail(
                transaction.renter.email,
                `Request Accepted: ${transaction.item.title}`,
                'Your Request was Accepted!',
                `Great news! The lender has accepted your request to borrow **${transaction.item.title}**. Please log in to the LendIT platform to coordinate pickup.`
            ).catch(err => this.logger.error('Failed to send acceptance email', err));

            return tx.borrowTransaction.findUnique({
                where: { id: transactionId },
                include: { chat: true, item: true, renter: true }
            });
        });

        // Emit notification AFTER successful transaction
        if (result && 'item' in result && result.item) {
            this.chatGateway.server.to(`user:${result.renterId}`).emit('notification', {
                title: 'Request Accepted 🚀',
                body: `Your rental request for ${(result.item as any).title} was accepted! You can now chat with the lender.`,
                link: `#/rentals`
            });
        }

        return result;
    }

    // ─── 3. Pay (Escrow) ────────────────────────────────────────────────────

    async initiatePaymentIntent(transactionId: string, renterId: string) {
        return this.prisma.$transaction(async (tx) => {
            // LAYER 0: Exclusive lock on Wallet (Prevents double HOLD creation)
            const [wallet] = await tx.$queryRaw<any[]>`
                SELECT * FROM "wallets" WHERE "userId" = ${renterId} FOR UPDATE
            `;
            if (!wallet) throw new NotFoundException('Wallet not found');

            const borrowTx = await tx.borrowTransaction.findUnique({
                where: { id: transactionId },
                include: { lender: { select: { lastSeenAt: true } } }
            });

            if (!borrowTx) throw new NotFoundException('Transaction not found');
            if (borrowTx.renterId !== renterId) throw new ForbiddenException('Access denied');

            // INVARIANT 2: Single active HOLD prevention
            const existingHold = await tx.walletTransaction.findFirst({
                where: { borrowTxId: transactionId, type: 'HOLD' }
            });

            if (borrowTx.status === 'PAYMENT_PENDING' && existingHold) {
                const expiresAt = new Date(borrowTx.paymentStartedAt!.getTime() + 10 * 60 * 1000);
                return { ...borrowTx, expiresAt };
            }

            if (borrowTx.status !== 'ACCEPTED') {
                throw new BadRequestException('Request must be ACCEPTED by lender before initiating payment');
            }

            // PHASE 1: Wallet Hold
            const availableBalance = wallet.balance - wallet.holdBalance;
            if (availableBalance < borrowTx.totalPaid) {
                throw new BadRequestException(`Insufficient available balance. Required: ₹${borrowTx.totalPaid}, Available: ₹${availableBalance.toFixed(2)}`);
            }

            await tx.wallet.update({
                where: { id: wallet.id },
                data: { holdBalance: { increment: borrowTx.totalPaid } }
            });

            await tx.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: 'HOLD',
                    amount: borrowTx.totalPaid,
                    balanceAfter: wallet.balance,
                    description: `Fund hold for checkout reservation: ${borrowTx.id}`,
                    borrowTxId: borrowTx.id
                }
            });

            const updated = await tx.borrowTransaction.update({
                where: { id: transactionId },
                data: {
                    status: 'PAYMENT_PENDING',
                    paymentStartedAt: new Date()
                },
                include: { lender: { select: { lastSeenAt: true } }, item: true }
            });

            const expiresAt = new Date(updated.paymentStartedAt!.getTime() + 10 * 60 * 1000);
            return { ...updated, expiresAt };
        });
    }

    async processPayment(transactionId: string, renterId: string) {
        this.logger.log({ event: 'PAYMENT_START', txId: transactionId, userId: renterId });

        try {
        const result = await this.prisma.$transaction(async (tx) => {
            // ── 1. Advisory lock ─────────────────────────────────────────
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${transactionId}))`;

            // ── 2. Lock wallet row ───────────────────────────────────────
            const [walletRow] = await tx.$queryRaw<any[]>`
                SELECT * FROM "wallets" WHERE "userId" = ${renterId} FOR UPDATE
            `;
            if (!walletRow) throw new NotFoundException('Wallet not found');

            // ── 3. Lock transaction row ──────────────────────────────────
            const [txRow] = await tx.$queryRaw<any[]>`
                SELECT * FROM "borrow_transactions"
                WHERE id = ${transactionId}
                FOR UPDATE
            `;
            if (!txRow) throw new NotFoundException('Transaction not found');

            // ── 4. Validate ──────────────────────────────────────────────
            if (txRow.renterId !== renterId) {
                throw new ForbiddenException('Only the renter can pay');
            }
            if (isNaN(txRow.totalPaid) || txRow.totalPaid <= 0) {
                throw new BadRequestException('Invalid payment amount');
            }

            // ── 5. Idempotency — already paid? ───────────────────────────
            if (txRow.paymentStatus === 'PAID') {
                return txRow;
            }
            if (txRow.status !== TransactionStatus.PAYMENT_PENDING) {
                throw new BadRequestException('Checkout not initiated. Please start payment again.');
            }

            // ── 6. Validate HOLD ─────────────────────────────────────────
            const holdRecord = await tx.walletTransaction.findFirst({
                where: { borrowTxId: transactionId, type: 'HOLD' }
            });
            if (!holdRecord || Math.abs(holdRecord.amount - txRow.totalPaid) > 0.01) {
                throw new BadRequestException('Payment session invalid or expired. Please start payment again.');
            }

            // ── 7. Expiry check ──────────────────────────────────────────
            const expiryThreshold = new Date(Date.now() - 10 * 60 * 1000);
            if (txRow.paymentStartedAt && txRow.paymentStartedAt < expiryThreshold) {
                await tx.wallet.update({
                    where: { id: walletRow.id },
                    data: { holdBalance: { decrement: txRow.totalPaid } }
                });
                await tx.walletTransaction.create({
                    data: {
                        walletId: walletRow.id,
                        type: 'RELEASE',
                        amount: txRow.totalPaid,
                        balanceAfter: walletRow.balance,
                        description: `Hold released - Session expired: ${txRow.id}`,
                        borrowTxId: txRow.id
                    }
                });
                await tx.borrowTransaction.update({
                    where: { id: txRow.id },
                    data: { status: TransactionStatus.CANCELLED }
                });
                this.logger.warn({ event: 'PAYMENT_EXPIRED', txId: txRow.id, amount: txRow.totalPaid });
                return { _isExpired: true };
            }

            // ── 8. Pre-settlement validation ─────────────────────────────
            this.validateTransition(txRow.status as TransactionStatus, TransactionStatus.PAID);

            if (walletRow.balance < txRow.totalPaid) {
                throw new BadRequestException('Insufficient balance');
            }

            const settledBalance = parseFloat((walletRow.balance - txRow.totalPaid).toFixed(2));

            // Debit-side idempotency guard
            const existingDebit = await tx.walletTransaction.findFirst({
                where: { borrowTxId: transactionId, type: { in: ['DEBIT', 'PLATFORM_FEE'] } }
            });
            if (existingDebit) {
                return await tx.borrowTransaction.findUnique({ where: { id: transactionId } });
            }

            // ── 9. Financial settlement (atomic) ─────────────────────────
            // 9a. Settle wallet: deduct balance + release hold
            const settledWallet = await tx.wallet.update({
                where: { id: walletRow.id },
                data: {
                    balance: settledBalance,
                    holdBalance: { decrement: txRow.totalPaid }
                }
            });

            if (settledWallet.balance < 0) {
                throw new ConflictException('Wallet integrity violation: Negative balance prevented.');
            }

            // 9b. DEBIT ledger entry
            await tx.walletTransaction.create({
                data: {
                    walletId: walletRow.id,
                    type: 'DEBIT',
                    amount: txRow.totalPaid,
                    balanceAfter: settledBalance,
                    description: `Settled payment for rental: ${txRow.id}`,
                    borrowTxId: txRow.id,
                }
            });

            // 9c. PLATFORM_FEE ledger entry (if applicable)
            if (txRow.platformFee && txRow.platformFee > 0) {
                await tx.walletTransaction.create({
                    data: {
                        walletId: walletRow.id,
                        type: 'PLATFORM_FEE',
                        amount: txRow.platformFee,
                        balanceAfter: settledBalance,
                        description: `Platform fee for rental: ${txRow.id}`,
                        borrowTxId: txRow.id,
                    }
                });
            }

            // ── 10. Update transaction status ────────────────────────────
            const updatedTx = await tx.borrowTransaction.updateMany({
                where: { id: transactionId, paymentStatus: 'PENDING' },
                data: {
                    paymentStatus: 'PAID',
                    status: TransactionStatus.PAID,
                    escrowHeld: true,
                    paidAt: new Date(),
                },
            });

            if (updatedTx.count !== 1) {
                const check = await tx.borrowTransaction.findUnique({ where: { id: transactionId } });
                if (check && check.paymentStatus === 'PAID') return check;
                throw new ConflictException('Transaction state conflict. Payment may have already been processed.');
            }

            // ── 11. Generate OTPs ────────────────────────────────────────
            const pickupOTP = Math.floor(100000 + Math.random() * 900000).toString();
            const returnOTP = Math.floor(100000 + Math.random() * 900000).toString();
            await tx.transactionOTP.create({
                data: { transactionId: txRow.id, pickupOTP, returnOTP }
            });

            // ── 12. Final write-after-read verification ──────────────────
            const verifiedTx = await tx.borrowTransaction.findUnique({
                where: { id: transactionId }
            });

            if (!verifiedTx || verifiedTx.status !== TransactionStatus.PAID || verifiedTx.paymentStatus !== 'PAID') {
                throw new ConflictException('Transaction state mismatch: Integrity verification failed.');
            }

            this.logger.log({ event: 'PAYMENT_SUCCESS', txId: transactionId, amount: txRow.totalPaid });
            return verifiedTx;
        });

        if (result && (result as any)._isExpired) {
            throw new BadRequestException('Checkout session expired. Please rebook.');
        }

        return result;
    } catch (error: any) {
        this.logger.error({ event: 'PAYMENT_FAILED', txId: transactionId, error: error?.message || error });
        throw error;
    }
    }

    // ─── 4. Item Collected → Start Timer (ACTIVE) ───────────────────────────

    async markItemCollected(transactionId: string, renterId: string, otp: string) {
        return this.prisma.$transaction(async (tx) => {
            const borrowTx = await tx.borrowTransaction.findUnique({
                where: { id: transactionId },
            });

            if (!borrowTx) throw new NotFoundException('Transaction not found');
            if (borrowTx.renterId !== renterId) throw new ForbiddenException('Only the renter can mark item as collected');
            if (borrowTx.status !== TransactionStatus.PAID || !borrowTx.escrowHeld) {
                throw new BadRequestException('Transaction must be PAID before marking collected');
            }

            const txOTP = await tx.transactionOTP.findUnique({ where: { transactionId } });
            if (!txOTP || txOTP.pickupOTP !== otp) {
                throw new BadRequestException('Invalid Pickup OTP. Please request the 6-digit code from the Lender.');
            }

            // Calculate server-side timestamps
            const startedAt = new Date();
            const durationMs =
                borrowTx.durationType === DurationType.HOURS
                    ? borrowTx.durationValue * 60 * 60 * 1000
                    : borrowTx.durationValue * 24 * 60 * 60 * 1000;

            const endsAt = borrowTx.rentalType === RentalType.EXAM_PASS
                ? new Date(EXAM_CONFIG.examEnd)
                : new Date(startedAt.getTime() + durationMs);
            const graceEndsAt = new Date(endsAt.getTime() + GRACE_PERIOD_MS);

            // const delay_to_grace = endsAt.getTime() - Date.now();
            // const delay_to_late = graceEndsAt.getTime() - Date.now();

            // Schedule BullMQ jobs (server-side timers)
            /*
            const [graceJob, lateJob] = await Promise.all([
                this.timerQueue.add(GRACE_JOB, { transactionId }, { delay: delay_to_grace, attempts: 3, backoff: 5000 }),
                this.timerQueue.add(LATE_JOB, { transactionId }, { delay: delay_to_late, attempts: 3, backoff: 5000 }),
            ]);
            */

            const updated = await tx.borrowTransaction.update({
                where: { id: transactionId },
                data: {
                    status: TransactionStatus.ACTIVE,
                    startedAt,
                    endsAt,
                    graceEndsAt,
                    graceJobId: "mocked-grace",
                    lateJobId: "mocked-late",
                },
            });

            this.logger.log(`Transaction ${transactionId} ACTIVE. Ends: ${endsAt.toISOString()}`);
            return updated;
        });
    }

    // ─── 5. Mark Returned ───────────────────────────────────────────────────

    async markReturned(transactionId: string, renterId: string, otp: string) {
        return this.prisma.$transaction(async (tx) => {
            const borrowTx = await tx.borrowTransaction.findUnique({
                where: { id: transactionId },
            });

            if (!borrowTx) throw new NotFoundException('Transaction not found');
            if (borrowTx.renterId !== renterId) throw new ForbiddenException('Only the renter can process the return using the OTP');

            // PAID (if collected not pressed) or ACTIVE/GRACE/LATE
            if (!['PAID', 'ACTIVE', 'GRACE', 'LATE'].includes(borrowTx.status)) {
                throw new BadRequestException(`Cannot mark returned from ${borrowTx.status} status`);
            }

            const txOTP = await tx.transactionOTP.findUnique({ where: { transactionId } });
            if (!txOTP || txOTP.returnOTP !== otp) {
                throw new BadRequestException('Invalid Return OTP. Please request the 6-digit code from the Lender.');
            }

            // Payout invariant requires escrow to be held first
            if (!borrowTx.escrowHeld) {
                throw new ConflictException('Cannot return an item if escrow was never paid');
            }

            const lenderWallet = await tx.wallet.findUnique({
                where: { userId: borrowTx.lenderId }
            });
            if (!lenderWallet) throw new BadRequestException('Lender wallet not found');

            // PAYOUT INVARIANT / IDEMPOTENCY GUARD
            // Rely on Postgres row-level locking via UPDATE ... WHERE
            const atomicGuard = await tx.borrowTransaction.updateMany({
                where: { id: transactionId, escrowReleased: false },
                data: {
                    status: TransactionStatus.RETURNED,
                    returnedAt: new Date(),
                    escrowReleased: true,
                },
            });

            if (atomicGuard.count === 0) {
                throw new ConflictException('Return already processed or payout already released');
            }

            const newBalance = parseFloat((lenderWallet.balance + borrowTx.lenderPayout).toFixed(2));

            // 1. Atomically increment the cached wallet projection
            await tx.wallet.update({
                where: { id: lenderWallet.id },
                data: { balance: newBalance },
            });

            // 2. Create the CREDIT ledger entry
            await tx.walletTransaction.create({
                data: {
                    walletId: lenderWallet.id,
                    type: 'CREDIT',
                    amount: borrowTx.lenderPayout,
                    balanceAfter: newBalance,
                    description: `Payout for rental: ${borrowTx.id}`,
                    borrowTxId: borrowTx.id,
                },
            });

            // Cancel pending timer jobs (best effort)
            try {
                /*
                if (borrowTx.graceJobId) await this.timerQueue.getJob(borrowTx.graceJobId).then(j => j?.remove());
                if (borrowTx.lateJobId) await this.timerQueue.getJob(borrowTx.lateJobId).then(j => j?.remove());
                */
            } catch {
                this.logger.warn(`Could not cancel timer jobs for ${transactionId}`);
            }

            this.logger.log(`Transaction ${transactionId} RETURNED. Lender credited ₹${borrowTx.lenderPayout}`);
            return { message: 'Item returned. Lender wallet credited.', lenderPayout: borrowTx.lenderPayout };
        });
    }

    // ─── 5.5 Cancel Transaction ─────────────────────────────────────────────

    async cancelTransaction(transactionId: string, userId: string) {
        return this.prisma.$transaction(async (tx) => {
            const borrowTx = await tx.borrowTransaction.findUnique({
                where: { id: transactionId },
            });

            if (!borrowTx) throw new NotFoundException('Transaction not found');
            if (borrowTx.renterId !== userId && borrowTx.lenderId !== userId) {
                throw new ForbiddenException('Only the renter or lender can cancel');
            }

            if (!['REQUESTED', 'ACCEPTED', 'PAYMENT_PENDING', 'PAID'].includes(borrowTx.status as string)) {
                throw new BadRequestException(`Cannot cancel from ${borrowTx.status} status`);
            }

            // If PAYMENT_PENDING: release the wallet hold first
            if (borrowTx.status === TransactionStatus.PAYMENT_PENDING) {
                const wallet = await tx.wallet.findUnique({ where: { userId: borrowTx.renterId } });
                if (wallet && wallet.holdBalance >= borrowTx.totalPaid) {
                    const updatedWallet = await tx.wallet.update({
                        where: { id: wallet.id },
                        data: { holdBalance: { decrement: borrowTx.totalPaid } }
                    });
                    await tx.walletTransaction.create({
                        data: {
                            walletId: wallet.id,
                            type: 'RELEASE',
                            amount: borrowTx.totalPaid,
                            balanceAfter: updatedWallet.balance,
                            description: `Hold released - Request cancelled: ${borrowTx.id}`,
                            borrowTxId: borrowTx.id
                        }
                    });
                }
            }

            // If PAID, handle escrow refund
            if (borrowTx.status === 'PAID' || borrowTx.escrowHeld) {
                const renterWallet = await tx.wallet.findUnique({
                    where: { userId: borrowTx.renterId }
                });

                if (renterWallet && !borrowTx.escrowReleased) {
                    const isRenterCancelling = userId === borrowTx.renterId;
                    // Renter cancels: refund base price only (retain platformFee)
                    // Lender cancels: full refund (not renter's fault)
                    const baseRefund = borrowTx.finalPrice ?? borrowTx.rentAmount;
                    const refundAmount = isRenterCancelling ? baseRefund : borrowTx.totalPaid;

                    const newBalance = parseFloat((renterWallet.balance + refundAmount).toFixed(2));
                    await tx.wallet.update({
                        where: { id: renterWallet.id },
                        data: { balance: newBalance }
                    });
                    await tx.walletTransaction.create({
                        data: {
                            walletId: renterWallet.id,
                            type: 'CREDIT',
                            amount: refundAmount,
                            balanceAfter: newBalance,
                            description: isRenterCancelling
                                ? `Partial refund (platform fee retained) for cancelled rental: ${borrowTx.id}`
                                : `Full refund for cancelled rental: ${borrowTx.id}`,
                            borrowTxId: borrowTx.id,
                        }
                    });
                }
            }

            // Update status
            await tx.borrowTransaction.update({
                where: { id: transactionId },
                data: { status: TransactionStatus.CANCELLED, escrowReleased: true },
            });

            // If lender cancelled AFTER payment, apply warning penalty
            if ((borrowTx.status === 'PAID' || borrowTx.escrowHeld) && userId === borrowTx.lenderId) {
                await tx.user.update({
                    where: { id: borrowTx.lenderId },
                    data: { warnings: { increment: 1 } }
                });
            }

            this.logger.log(`Transaction ${transactionId} CANCELLED by user ${userId}`);
            return { message: 'Transaction cancelled successfully.' };
        });
    }

    // ─── 6. Get Transaction ─────────────────────────────────────────────────

    async getTransaction(transactionId: string, userId: string) {
        const tx = await this.prisma.borrowTransaction.findUnique({
            where: { id: transactionId },
            include: {
                item: { select: { id: true, title: true, images: true } },
                renter: { select: { id: true, name: true, email: true } },
                lender: { select: { id: true, name: true, email: true } },
                chat: { select: { id: true, isUnlocked: true } },
                otp: true,
            },
        });

        if (!tx) throw new NotFoundException('Transaction not found');
        if (tx.renterId !== userId && tx.lenderId !== userId) {
            throw new ForbiddenException('You are not a party to this transaction');
        }

        // Hide OTP from renter to prevent bypassing
        if (tx.renterId === userId && tx.otp) {
            delete (tx as any).otp;
        }

        return tx;
    }

    async getMyTransactionsAsRenter(renterId: string) {
        return this.prisma.borrowTransaction.findMany({
            where: { renterId },
            include: { item: { select: { id: true, title: true, images: true } }, lender: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'desc' },
        });
    }

    async getMyTransactionsAsLender(lenderId: string) {
        return this.prisma.borrowTransaction.findMany({
            where: { lenderId },
            include: { item: { select: { id: true, title: true, images: true } }, renter: { select: { id: true, name: true } }, otp: true },
            orderBy: { createdAt: 'desc' },
        });
    }

    // ─── 7. Get OTP (Lender only) ────────────────────────────────────────────

    async getTransactionOtp(transactionId: string, userId: string) {
        const tx = await this.prisma.borrowTransaction.findUnique({
            where: { id: transactionId },
            include: { otp: true },
        });
        if (!tx) throw new NotFoundException('Transaction not found');
        if (tx.lenderId !== userId) throw new ForbiddenException('Only the lender can view OTPs');

        // Handle legacy transactions that were created before OTP feature
        if (!tx.otp) {
            if (['PAID', 'ACTIVE', 'GRACE', 'LATE', 'RETURNED'].includes(tx.status)) {
                const pickupOTP = Math.floor(100000 + Math.random() * 900000).toString();
                const returnOTP = Math.floor(100000 + Math.random() * 900000).toString();
                const newOtp = await this.prisma.transactionOTP.create({
                    data: {
                        transactionId: tx.id,
                        pickupOTP,
                        returnOTP
                    }
                });
                return {
                    pickupOTP: newOtp.pickupOTP,
                    returnOTP: newOtp.returnOTP,
                };
            } else {
                throw new BadRequestException('OTPs not yet generated. Payment must be completed first.');
            }
        }

        return {
            pickupOTP: tx.otp.pickupOTP,
            returnOTP: tx.otp.returnOTP,
        };
    }

    // ─── Financial Audit ──────────────────────────────────────────────────
    // ─── System Sweeper: Cleanup Stale Holds ────────────────────────────────
    async releaseStaleHolds() {
        const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
        const stale = await this.prisma.borrowTransaction.findMany({
            where: {
                status: TransactionStatus.PAYMENT_PENDING,
                paymentStartedAt: { lt: tenMinsAgo }
            }
        });

        const results = [];
        for (const tx of stale) {
            try {
                await this.prisma.$transaction(async (prisma) => {
                    const wallet = await prisma.wallet.findUnique({ where: { userId: tx.renterId } });
                    if (wallet && wallet.holdBalance >= tx.totalPaid) {
                        await prisma.wallet.update({
                            where: { id: wallet.id },
                            data: { holdBalance: { decrement: tx.totalPaid } }
                        });
                        await prisma.walletTransaction.create({
                            data: {
                                walletId: wallet.id,
                                type: 'RELEASE',
                                amount: tx.totalPaid,
                                balanceAfter: wallet.balance,
                                description: `Hold released - Expiry sweeper: ${tx.id}`,
                                borrowTxId: tx.id
                            }
                        });
                    }
                    await prisma.borrowTransaction.update({
                        where: { id: tx.id },
                        data: { status: TransactionStatus.CANCELLED }
                    });
                });
                results.push({ id: tx.id, status: 'CLEANED' });
            } catch (e: any) {
                this.logger.error(`Failed to clean stale hold for ${tx.id}: ${e.message}`);
                results.push({ id: tx.id, status: 'FAILED', error: e.message });
            }
        }
        return results;
    }

    async auditLedger() {
        const stats = await this.prisma.$transaction(async (tx) => {
            const totalWalletDebits = await tx.walletTransaction.aggregate({
                where: { type: 'DEBIT' },
                _sum: { amount: true }
            });

            const totalPaidTransactions = await tx.borrowTransaction.aggregate({
                where: { status: { in: ['PAID', 'ACTIVE', 'RETURNED', 'LATE'] } },
                _sum: { totalPaid: true }
            });

            const debitSum = totalWalletDebits._sum.amount || 0;
            const paidSum = totalPaidTransactions._sum.totalPaid || 0;
            const drift = Math.abs(debitSum - paidSum);

            if (drift > 0.01) {
                this.logger.error(`🚨 LEDGER DRIFT DETECTED: ₹${drift.toFixed(2)}. Debits: ₹${debitSum}, Expected: ₹${paidSum}`);
            }

            return { debitSum, paidSum, drift, status: drift > 0.01 ? 'MISMATCH' : 'HEALTHY' };
        });

        return stats;
    }
}
