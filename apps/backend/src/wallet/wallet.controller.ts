import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import { WalletService } from './wallet.service';
import { IsNumber, IsPositive, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

class WithdrawalDto {
    @IsNumber()
    @IsPositive()
    @Min(100)
    @Max(10000)
    @Type(() => Number)
    amount!: number;
}

class DepositDto {
    @IsNumber()
    @IsPositive()
    @Min(10)
    @Max(10000)
    @Type(() => Number)
    amount!: number;
}

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
    constructor(private readonly walletService: WalletService) { }

    @Get()
    getWallet(@CurrentUser('id') userId: string) {
        return this.walletService.getWallet(userId);
    }

    @Get('history')
    getHistory(
        @CurrentUser('id') userId: string,
        @Query('page') page = 1,
        @Query('limit') limit = 20,
    ) {
        return this.walletService.getTransactionHistory(userId, Number(page), Number(limit));
    }

    @Post('deposit')
    deposit(
        @CurrentUser('id') userId: string,
        @Body() dto: DepositDto,
    ) {
        return this.walletService.deposit(userId, dto.amount);
    }

    @Post('withdraw')
    requestWithdrawal(
        @CurrentUser('id') userId: string,
        @Body() dto: WithdrawalDto,
    ) {
        return this.walletService.requestWithdrawal(userId, dto.amount);
    }
}
