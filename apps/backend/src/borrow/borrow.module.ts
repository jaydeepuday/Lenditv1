import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BorrowController } from './borrow.controller';
import { BorrowService, TIMER_QUEUE } from './borrow.service';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';

@Module({
    imports: [
        AuthModule,
        ChatModule,
        /* BullModule.registerQueue({ name: TIMER_QUEUE }), */
    ],
    controllers: [BorrowController],
    providers: [BorrowService],
    exports: [BorrowService],
})
export class BorrowModule { }
