import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
// import { BullModule } from '@nestjs/bull';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { ItemsModule } from './items/items.module';
import { BorrowModule } from './borrow/borrow.module';
import { TimerModule } from './timer/timer.module';
import { ChatModule } from './chat/chat.module';
import { WalletModule } from './wallet/wallet.module';
import { AdminModule } from './admin/admin.module';
import { ReportsModule } from './reports/reports.module';

import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';

@Module({
    imports: [
        // Config (available to all modules)
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: '.env',
        }),

        // Rate limiting
        ThrottlerModule.forRoot([
            {
                ttl: 60000, // 1 minute
                limit: 60,  // 60 requests per minute globally
            },
        ]),

        /*
        // BullMQ (Redis queue)
        BullModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                redis: {
                    host: configService.get<string>('REDIS_HOST', 'localhost'),
                    port: configService.get<number>('REDIS_PORT', 6379),
                },
            }),
        }),
        */

        // Shared infrastructure
        PrismaModule,
        RedisModule,

        // Feature modules
        AuthModule,
        ItemsModule,
        BorrowModule,
        TimerModule,
        ChatModule,
        WalletModule,
        AdminModule,
        ReportsModule,
    ],
    controllers: [AppController],
    providers: [
        // Global rate limiter
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        // Global JWT guard (routes marked @Public() are exempt)
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        // Global roles guard
        { provide: APP_GUARD, useClass: RolesGuard },
        // Global exception filter
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        // Global response transformer
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
        // Global validation pipe
        {
            provide: APP_PIPE,
            useValue: new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
                transformOptions: { enableImplicitConversion: true },
            }),
        },
    ],
})
export class AppModule { }
