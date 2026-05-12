import {
    Controller,
    Get,
    Patch,
    Delete,
    Param,
    Body,
    UseGuards,
    ParseUUIDPipe,
    NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
    constructor(private prisma: PrismaService) { }

    // ─── Stats ───────────────────────────────────────────────

    @Get('stats')
    async getStats() {
        const [users, items, transactions, pendingWithdrawals, pendingReports] = await Promise.all([
            this.prisma.user.count({ where: { isVerified: true } }),
            this.prisma.item.count({ where: { isActive: true } }),
            this.prisma.borrowTransaction.groupBy({ by: ['status'], _count: true }),
            this.prisma.withdrawalRequest.findMany({
                where: { status: 'PENDING' },
                include: { wallet: { include: { user: { select: { name: true, email: true } } } } },
                orderBy: { createdAt: 'asc' },
            }),
            this.prisma.report.count({ where: { status: 'PENDING' } }),
        ]);

        return { users, items, transactions, pendingWithdrawals, pendingReports };
    }

    // ─── Withdrawals ─────────────────────────────────────────

    @Get('withdrawals')
    async getPendingWithdrawals() {
        return this.prisma.withdrawalRequest.findMany({
            where: { status: 'PENDING' },
            include: {
                wallet: {
                    include: { user: { select: { id: true, name: true, email: true } } },
                },
            },
            orderBy: { createdAt: 'asc' },
        });
    }

    @Patch('withdrawals/:id/approve')
    async approveWithdrawal(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: { notes?: string },
    ) {
        return this.prisma.withdrawalRequest.update({
            where: { id },
            data: { status: 'APPROVED', notes: body.notes },
        });
    }

    @Patch('withdrawals/:id/reject')
    async rejectWithdrawal(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: { notes?: string },
    ) {
        const request = await this.prisma.withdrawalRequest.findUnique({
            where: { id },
            include: { wallet: true },
        });
        if (!request) return { message: 'Not found' };

        const newBalance = parseFloat((request.wallet.balance + request.amount).toFixed(2));

        await this.prisma.$transaction([
            this.prisma.withdrawalRequest.update({
                where: { id },
                data: { status: 'REJECTED', notes: body.notes },
            }),
            this.prisma.wallet.update({
                where: { id: request.walletId },
                data: { balance: newBalance },
            }),
            this.prisma.walletTransaction.create({
                data: {
                    walletId: request.walletId,
                    type: 'CREDIT',
                    amount: request.amount,
                    balanceAfter: newBalance,
                    description: `Withdrawal rejected — refunded ₹${request.amount}`,
                },
            }),
        ]);

        return { message: `Withdrawal rejected. ₹${request.amount} refunded to wallet.` };
    }

    // ─── Reports & Moderation ────────────────────────────────

    @Get('reports')
    async getReports() {
        const reports = await this.prisma.report.findMany({
            where: { status: 'PENDING' },
            include: {
                reporter: { select: { id: true, name: true, email: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        // Enrich ITEM reports with item details
        const enriched = await Promise.all(
            reports.map(async (report) => {
                if (report.type === 'ITEM') {
                    const item = await this.prisma.item.findUnique({
                        where: { id: report.reportedId },
                        select: {
                            id: true,
                            title: true,
                            images: true,
                            category: true,
                            isActive: true,
                            owner: { select: { id: true, name: true, email: true } },
                        },
                    });
                    return { ...report, item };
                }
                // USER reports — attach user info
                const reportedUser = await this.prisma.user.findUnique({
                    where: { id: report.reportedId },
                    select: { id: true, name: true, email: true },
                });
                return { ...report, reportedUser };
            }),
        );

        return enriched;
    }

    @Patch('reports/:id/dismiss')
    async dismissReport(@Param('id', ParseUUIDPipe) id: string) {
        const report = await this.prisma.report.findUnique({ where: { id } });
        if (!report) throw new NotFoundException('Report not found');

        await this.prisma.report.update({
            where: { id },
            data: { status: 'RESOLVED' },
        });

        return { message: 'Report dismissed.' };
    }

    @Delete('items/:id')
    async removeItem(@Param('id', ParseUUIDPipe) id: string) {
        const item = await this.prisma.item.findUnique({ where: { id } });
        if (!item) throw new NotFoundException('Item not found');

        // Soft-delete the item and resolve all related PENDING reports
        await this.prisma.$transaction([
            this.prisma.item.update({
                where: { id },
                data: { isActive: false, isAvailable: false },
            }),
            this.prisma.report.updateMany({
                where: { reportedId: id, status: 'PENDING' },
                data: { status: 'RESOLVED' },
            }),
        ]);

        return { message: `Item "${item.title}" has been removed.` };
    }
}
