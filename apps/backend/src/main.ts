import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { json, static as serveStatic, Request, Response, NextFunction } from 'express';
import { join } from 'path';
import compression from 'compression';

async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        logger: ['error', 'warn', 'log', 'debug'],
        bodyParser: false,
    });

    const logger = new Logger('Bootstrap');

    // Gzip compression — must be first to compress all responses
    app.use(compression());

    // Increase body size limit to 10MB (needed for base64 image uploads)
    app.use(json({ limit: '10mb' }));


    // Cookie parser (for HTTP-only JWT cookies)
    app.use(cookieParser());

    // CORS — allow all origins (ngrok, localhost, LAN IPs) and specific production frontends
    app.enableCors({
        origin: [
            'http://localhost:3000',
            'http://localhost:3001',
            'https://lendit-ashen.vercel.app'
        ],
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    });

    // API prefix (must be set BEFORE static serving)
    app.setGlobalPrefix('api/v1');

    // Serve frontend static files from the vanilla app folder
    const frontendPath = join(__dirname, '..', '..', '..', 'frontend');
    app.use(serveStatic(frontendPath));

    // SPA fallback — serve index.html for any non-API route (supports hash routing)
    app.use((req: Request, res: Response, next: NextFunction) => {
        if (!req.path.startsWith('/api/')) {
            res.sendFile(join(frontendPath, 'index.html'));
        } else {
            next();
        }
    });

    const port = process.env.PORT || 3001;
    await app.listen(port);
    logger.log(`🚀 lendIT running at http://localhost:${port} (API: /api/v1)`);
}

bootstrap().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
});
