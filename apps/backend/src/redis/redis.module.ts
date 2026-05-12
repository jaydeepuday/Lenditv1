import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
    imports: [ConfigModule],
    providers: [
        {
            provide: REDIS_CLIENT,
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const client = new Redis({
                    host: configService.get<string>('REDIS_HOST', 'localhost'),
                    port: configService.get<number>('REDIS_PORT', 6379),
                    lazyConnect: true,        // don't connect on startup
                    retryStrategy: () => null, // don't retry — fail silently
                    maxRetriesPerRequest: null,
                });
                client.on('connect', () => console.log('✅ Redis connected'));
                client.on('error', (err) => {
                    // Log once, don't crash the server
                    if ((client as any)._errorLogged) return;
                    (client as any)._errorLogged = true;
                    console.warn('⚠️  Redis unavailable — queue/cache features disabled:', err.message);
                });
                return client;
            },
        },
    ],
    exports: [REDIS_CLIENT],
})
export class RedisModule { }
