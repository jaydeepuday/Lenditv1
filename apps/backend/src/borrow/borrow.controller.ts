import {
    Controller,
    Get,
    Post,
    Patch,
    Body,
    Param,
    UseGuards,
    ParseUUIDPipe,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import { BorrowService } from './borrow.service';
import { RequestBorrowDto, AcceptBorrowDto } from './dto/borrow.dto';

@Controller('borrow')
@UseGuards(JwtAuthGuard)
export class BorrowController {
    constructor(private readonly borrowService: BorrowService) { }

    @Post()
    async requestBorrow(
        @CurrentUser() user: any,
        @Body() dto: RequestBorrowDto,
    ) {
        return this.borrowService.requestBorrow(user.id || user.sub, dto);
    }

    @Post('check-turnover')
    @HttpCode(HttpStatus.OK)
    async checkTurnover(@Body() dto: RequestBorrowDto) {
        return this.borrowService.checkTurnover(dto);
    }

    @Post(':id/initiate-checkout')
    @HttpCode(HttpStatus.OK)
    async initiateCheckout(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: any,
    ) {
        return this.borrowService.initiatePaymentIntent(id, user.id || user.sub);
    }

    @Patch(':id/respond')
    async respond(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: any,
        @Body() dto: AcceptBorrowDto,
    ) {
        return this.borrowService.respondToRequest(id, user.id || user.sub, dto);
    }

    @Post(':id/pay')
    @HttpCode(HttpStatus.OK)
    async pay(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: any,
    ) {
        return this.borrowService.processPayment(id, user.id || user.sub);
    }

    @Post(':id/collect')
    @HttpCode(HttpStatus.OK)
    async collect(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: any,
        @Body('otp') otp: string,
    ) {
        return this.borrowService.markItemCollected(id, user.id || user.sub, otp);
    }

    @Post(':id/cancel')
    @HttpCode(HttpStatus.OK)
    async cancelTransaction(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: any,
    ) {
        return this.borrowService.cancelTransaction(id, user.id || user.sub);
    }

    @Post(':id/return')
    @HttpCode(HttpStatus.OK)
    async returnItem(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: any,
        @Body('otp') otp: string,
    ) {
        return this.borrowService.markReturned(id, user.id || user.sub, otp);
    }

    @Get(':id/otp')
    async getOtp(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: any,
    ) {
        return this.borrowService.getTransactionOtp(id, user.id || user.sub);
    }

    @Get('my/renting')
    async myRentals(@CurrentUser() user: any) {
        return this.borrowService.getMyTransactionsAsRenter(user.id || user.sub);
    }

    @Get('my/lending')
    async myLendings(@CurrentUser() user: any) {
        return this.borrowService.getMyTransactionsAsLender(user.id || user.sub);
    }

    @Get(':id')
    async getTransaction(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: any,
    ) {
        return this.borrowService.getTransaction(id, user.id || user.sub);
    }
}
