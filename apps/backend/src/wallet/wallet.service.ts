import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MIN_WITHDRAWAL = 100; // INR

@Injectable()
export class WalletService {
    constructor(private prisma: PrismaService) { }

    async getWallet(userId: string) {
        const wallet = await this.prisma.wallet.findUnique({
            where: { userId },
            include: {
                transactions: {
                    orderBy: { createdAt: 'desc' },
                    take: 50,
                },
            },
        });

        if (!wallet) throw new NotFoundException('Wallet not found');
        return wallet;
    }

    async deposit(userId: string, amount: number) {
        if (amount < 10) throw new BadRequestException('Minimum deposit is ₹10');
        if (amount > 10000) throw new BadRequestException('Maximum deposit is ₹10,000');

        const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new NotFoundException('Wallet not found');

        const newBalance = parseFloat((wallet.balance + amount).toFixed(2));

        await this.prisma.$transaction([
            this.prisma.wallet.update({
                where: { id: wallet.id },
                data: { balance: newBalance },
            }),
            this.prisma.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: 'CREDIT',
                    amount,
                    balanceAfter: newBalance,
                    description: `Wallet top-up of ₹${amount}`,
                },
            }),
        ]);

        return { message: `₹${amount} added to your wallet.`, newBalance };
    }

    async getTransactionHistory(userId: string, page = 1, limit = 20) {
        const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new NotFoundException('Wallet not found');

        const skip = (page - 1) * limit;
        const [transactions, total] = await Promise.all([
            this.prisma.walletTransaction.findMany({
                where: { walletId: wallet.id },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
        ]);

        return { transactions, pagination: { total, page, limit } };
    }

    async requestWithdrawal(userId: string, amount: number) {
        if (amount < MIN_WITHDRAWAL) {
            throw new BadRequestException(`Minimum withdrawal amount is ₹${MIN_WITHDRAWAL}`);
        }

        const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new NotFoundException('Wallet not found');
        if (wallet.balance < amount) {
            throw new BadRequestException(`Insufficient balance. Available: ₹${wallet.balance}`);
        }

        // Check for pending withdrawal requests
        const pendingRequest = await this.prisma.withdrawalRequest.findFirst({
            where: { walletId: wallet.id, status: 'PENDING' },
        });
        if (pendingRequest) {
            throw new BadRequestException('You already have a pending withdrawal request');
        }

        const newBalance = parseFloat((wallet.balance - amount).toFixed(2));

        // Atomic: debit wallet + create ledger entry + create withdrawal request
        await this.prisma.$transaction([
            this.prisma.wallet.update({
                where: { id: wallet.id },
                data: { balance: newBalance },
            }),
            this.prisma.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: 'WITHDRAWAL_REQUEST',
                    amount: -amount,
                    balanceAfter: newBalance,
                    description: `Withdrawal request for ₹${amount}`,
                },
            }),
            this.prisma.withdrawalRequest.create({
                data: { walletId: wallet.id, amount },
            }),
        ]);

        return {
            message: `Withdrawal request for ₹${amount} submitted. It will be processed within 2-3 business days.`,
            newBalance,
        };
    }
}
