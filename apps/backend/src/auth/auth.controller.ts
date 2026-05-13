import {
    Controller,
    Post,
    Get,
    Body,
    Res,
    Req,
    HttpCode,
    HttpStatus,
    UseGuards,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard, JwtRefreshGuard } from './guards/jwt-auth.guard';
import { CurrentUser, Public } from '../common/decorators';
import { SignupDto, VerifyOtpDto, ResendOtpDto, LoginDto } from './dto/auth.dto';

// Use SameSite=None + Secure for HTTPS origins (ngrok, production)
// Use SameSite=Lax  + no Secure for plain HTTP (localhost dev)
function getCookieOptions() {
    const isHttps = process.env.NODE_ENV === 'production' || process.env.FORCE_SECURE_COOKIES === 'true';
    return {
        httpOnly: true,
        secure: isHttps,
        sameSite: isHttps ? ('none' as const) : ('lax' as const),
        path: '/',
    };
}

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Public()
    @Post('signup')
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    async signup(@Body() dto: SignupDto, @Res({ passthrough: true }) res: Response) {
        const result = await this.authService.signup(dto);
        if (result.tokens) {
            this.setTokenCookies(res, result.tokens.accessToken, result.tokens.refreshToken);
            delete result.tokens;
        }
        return result;
    }

    @Public()
    @Post('verify-otp')
    @HttpCode(HttpStatus.OK)
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    async verifyOtp(
        @Body() dto: VerifyOtpDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const result = await this.authService.verifyOtp(dto);
        if ('accessToken' in result && result.accessToken) {
            this.setTokenCookies(res, result.accessToken, result.refreshToken);
        }
        return result;
    }

    @Public()
    @Post('resend-otp')
    @HttpCode(HttpStatus.OK)
    @Throttle({ default: { limit: 3, ttl: 300000 } }) // 3 per 5 minutes
    async resendOtp(@Body() dto: ResendOtpDto) {
        return this.authService.resendOtp(dto.email);
    }

    @Public()
    @Post('login')
    @HttpCode(HttpStatus.OK)
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    async login(
        @Body() dto: LoginDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const result = await this.authService.login(dto);
        this.setTokenCookies(res, result.accessToken, result.refreshToken);
        return result;
    }

    @Public()
    @UseGuards(JwtRefreshGuard)
    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
        const user = req.user as any;
        const result = await this.authService.refreshTokens(user.sub, user.refreshToken);
        this.setTokenCookies(res, result.accessToken, result.refreshToken);
        return result;
    }

    @Post('logout')
    @HttpCode(HttpStatus.OK)
    async logout(
        @CurrentUser() user: any,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        const userId = user.id || user.sub;
        const refreshToken = req.cookies?.['refresh_token'];
        res.clearCookie('access_token', getCookieOptions());
        res.clearCookie('refresh_token', getCookieOptions());
        return this.authService.logout(userId, refreshToken);
    }

    @Get('me')
    async getProfile(@CurrentUser() user: any) {
        return this.authService.getProfile(user.id || user.sub);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private setTokenCookies(res: Response, accessToken: string, refreshToken: string) {
        const opts = getCookieOptions();
        res.cookie('access_token', accessToken, {
            ...opts,
            maxAge: 15 * 60 * 1000, // 15 minutes
        });
        res.cookie('refresh_token', refreshToken, {
            ...opts,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });
    }
}
