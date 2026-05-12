import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '@prisma/client';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(GlobalExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let message = 'Internal server error';
        let errors: any = undefined;

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const res = exception.getResponse();
            if (typeof res === 'string') {
                message = res;
            } else if (typeof res === 'object') {
                message = (res as any).message || message;
                errors = (res as any).errors;
            }
        } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
            if (exception.code === 'P2002') {
                status = HttpStatus.CONFLICT;
                message = 'A record with that value already exists';
            } else if (exception.code === 'P2025') {
                status = HttpStatus.NOT_FOUND;
                message = 'Record not found';
            } else {
                this.logger.error(`Prisma error: ${exception.code}`, exception.message);
            }
        } else {
            this.logger.error('Unhandled exception', exception);
        }

        response.status(status).json({
            success: false,
            statusCode: status,
            message,
            ...(errors && { errors }),
            timestamp: new Date().toISOString(),
        });
    }
}
