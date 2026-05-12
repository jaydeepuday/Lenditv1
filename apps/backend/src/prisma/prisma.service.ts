import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PrismaService.name);

    constructor() {
        const connectionString = process.env.DATABASE_URL || 'postgresql://lendit:lendit_secret@localhost:5432/lendit_db?schema=public';
        const pool = new Pool({ connectionString });
        const adapter = new PrismaPg(pool);
        super({
            adapter,
            log: [
                { level: 'warn', emit: 'event' },
                { level: 'error', emit: 'event' },
            ],
        } as any);
    }

    async onModuleInit() {
        await this.$connect();
        this.logger.log('Prisma connected to database');
    }

    async onModuleDestroy() {
        await this.$disconnect();
        this.logger.log('Prisma disconnected from database');
    }
}
