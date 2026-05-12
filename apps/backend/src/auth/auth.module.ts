import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { JwtAccessStrategy, JwtRefreshStrategy } from './jwt.strategy';

@Module({
    imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}), // Secrets configured per-call in AuthService
    ],
    controllers: [AuthController],
    providers: [AuthService, EmailService, JwtAccessStrategy, JwtRefreshStrategy],
    exports: [AuthService, EmailService],
})
export class AuthModule { }
