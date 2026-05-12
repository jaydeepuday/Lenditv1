import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TimerProcessor } from './timer.processor';
import { TimerService } from './timer.service';
import { TIMER_QUEUE } from '../borrow/borrow.service';

@Module({
    imports: [
        /* BullModule.registerQueue({ name: TIMER_QUEUE }), */
    ],
    providers: [TimerProcessor, TimerService],
    exports: [TimerService],
})
export class TimerModule { }
