import {
    Injectable,
    BadRequestException,
    ConflictException,
    UnauthorizedException,
    NotFoundException,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';
import { isStudentEmail, SignupDto, LoginDto, VerifyOtpDto } from './dto/auth.dto';
import { User } from '@prisma/client';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private configService: ConfigService,
        private emailService: EmailService,
    ) { }

    // ─── Signup ──────────────────────────────────────────────────────────────

    async signup(dto: SignupDto) {
        const email = dto.email.toLowerCase().trim();

        const bypassOtp =
            process.env.DISABLE_EMAIL_VERIFICATION === 'true';

        // 1. Allowlist-based student email validation (server-side)
        if (!isStudentEmail(email)) {
            throw new BadRequestException(
                'Only verified student email addresses are allowed. Please use your institutional (.edu, .ac.in) email.',
            );
        }

        // 2. Check for existing account
        const existing = await this.prisma.user.findUnique({ where: { email } });
        if (existing) {
            if (!existing.isVerified) {
                // Resend OTP for unverified account — don't expose it exists
                if (process.env.DISABLE_EMAIL_VERIFICATION !== 'true') {
                    await this.generateAndSendOtp(existing.id, email, existing.name);
                }
                return { message: 'OTP sent. Please verify your email.' };
            }
            throw new ConflictException('An account with this email already exists');
        }

        // 3. Hash password
        const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

        // 4. Create user + wallet + OTP atomically and send email
        try {
            await this.prisma.$transaction(async (tx) => {
                const newUser = await tx.user.create({
                    data: {
                        email,
                        passwordHash,
                        name: dto.name,
                        college: dto.college,
                        isVerified: bypassOtp,
                    },
                });

                // Create wallet for the new user immediately
                await tx.wallet.create({
                    data: { userId: newUser.id, balance: 0 },
                });

                // Generate and send OTP within the transaction
                // If email fails, it throws and rolls back everything!
                await this.generateAndSendOtp(newUser.id, email, dto.name, tx);
            });
        } catch (error) {
            if (error instanceof ConflictException || error instanceof BadRequestException) {
                throw error;
            }
            this.logger.error('Signup transaction failed (possibly email provider error)', error);
            throw new InternalServerErrorException('Unable to send OTP right now. Please try again.');
        }
        return {
            message: bypassOtp
                ? 'Account created successfully'
                : 'Account created. Please verify your email with the OTP sent.'
        };

    }

    // ─── Generate & Send OTP ─────────────────────────────────────────────────

    async generateAndSendOtp(userId: string, email: string, name: string, prismaClient: any = this.prisma): Promise<void> {
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const hash = await bcrypt.hash(otpCode, BCRYPT_ROUNDS);
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

        // Upsert OTP (overwrite existing pending OTP on resend)
        await prismaClient.oTP.upsert({
            where: { userId },
            update: { hash, attempts: 0, expiresAt, used: false },
            create: { userId, hash, attempts: 0, expiresAt, used: false },
        });


    }

    // ─── Verify OTP ──────────────────────────────────────────────────────────

    async verifyOtp(dto: VerifyOtpDto) {
        const email = dto.email.toLowerCase().trim();

        const user = await this.prisma.user.findUnique({
            where: { email },
            include: { otp: true },
        });

        if (!user) throw new NotFoundException('No account found with this email');
        if (user.isVerified) return { message: 'Email already verified. Please login.' };

        const otpRecord = user.otp;
        if (!otpRecord || otpRecord.used) {
            throw new BadRequestException('OTP is invalid or already used. Please request a new one.');
        }

        if (new Date() > otpRecord.expiresAt) {
            throw new BadRequestException('OTP has expired. Please request a new one.');
        }

        if (otpRecord.attempts >= this.configService.get<number>('OTP_MAX_ATTEMPTS', 3)) {
            throw new BadRequestException('Maximum OTP attempts exceeded. Please request a new one.');
        }

        const isValid = await bcrypt.compare(dto.otp, otpRecord.hash);

        if (!isValid) {
            // Increment attempts
            await this.prisma.oTP.update({
                where: { userId: user.id },
                data: { attempts: { increment: 1 } },
            });

            const remaining = this.configService.get<number>('OTP_MAX_ATTEMPTS', 3) - (otpRecord.attempts + 1);
            throw new BadRequestException(
                remaining > 0
                    ? `Invalid OTP. ${remaining} attempt(s) remaining.`
                    : 'Invalid OTP. Maximum attempts exceeded. Please request a new one.',
            );
        }

        // Mark OTP as used and user as verified — atomic
        await this.prisma.$transaction([
            this.prisma.oTP.update({ where: { userId: user.id }, data: { used: true } }),
            this.prisma.user.update({ where: { id: user.id }, data: { isVerified: true } }),
        ]);

        const tokens = await this.generateTokens(user);
        return { message: 'Email verified successfully', ...tokens };
    }

    // ─── Resend OTP ──────────────────────────────────────────────────────────

    async resendOtp(email: string) {
        email = email.toLowerCase().trim();
        const user = await this.prisma.user.findUnique({ where: { email } });

        if (!user) throw new NotFoundException('No account found with this email');
        if (user.isVerified) throw new BadRequestException('This account is already verified');

        try {
            await this.generateAndSendOtp(user.id, email, user.name);
        } catch (error) {
            this.logger.error('Resend OTP failed', error);
            throw new InternalServerErrorException('Unable to send OTP right now. Please try again.');
        }
        return { message: 'A new OTP has been sent to your email' };
    }

    // ─── Login ───────────────────────────────────────────────────────────────

    async login(dto: LoginDto) {
        const email = dto.email.toLowerCase().trim();
        const user = await this.prisma.user.findUnique({ where: { email } });

        if (!user) throw new UnauthorizedException('Invalid email or password');

        const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
        if (!passwordValid) throw new UnauthorizedException('Invalid email or password');

        if (!user.isVerified) {
            throw new UnauthorizedException('Please verify your email before logging in');
        }

        const tokens = await this.generateTokens(user);
        this.logger.log(`User logged in: ${email}`);
        return tokens;
    }

    // ─── Refresh Tokens ───────────────────────────────────────────────────────

    async refreshTokens(userId: string, refreshToken: string) {
        const tokenRecord = await this.prisma.refreshToken.findFirst({
            where: { userId, token: refreshToken, expiresAt: { gt: new Date() } },
            include: { user: true },
        });

        if (!tokenRecord) {
            throw new UnauthorizedException('Invalid or expired refresh token');
        }

        // Rotate: delete old, issue new
        await this.prisma.refreshToken.delete({ where: { id: tokenRecord.id } });
        return this.generateTokens(tokenRecord.user);
    }

    // ─── Logout ──────────────────────────────────────────────────────────────

    async logout(userId: string, refreshToken?: string) {
        if (refreshToken) {
            await this.prisma.refreshToken.deleteMany({ where: { userId, token: refreshToken } });
        } else {
            // Logout from all devices
            await this.prisma.refreshToken.deleteMany({ where: { userId } });
        }
        return { message: 'Logged out successfully' };
    }

    // ─── Token Generation ─────────────────────────────────────────────────────

    private async generateTokens(user: Pick<User, 'id' | 'email' | 'role'>) {
        const payload = { sub: user.id, email: user.email, role: user.role };

        const [accessToken, refreshToken] = await Promise.all([
            this.jwtService.signAsync(payload, {
                secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
                expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES_IN', '15m') as any,
            }),
            this.jwtService.signAsync(payload, {
                secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
                expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d') as any,
            }),
        ]);

        // Persist refresh token in DB
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        await this.prisma.refreshToken.create({
            data: { token: refreshToken, userId: user.id, expiresAt },
        });

        return {
            accessToken,
            refreshToken,
            user: { id: user.id, email: user.email, role: user.role },
        };
    }

    // ─── Get Current User ─────────────────────────────────────────────────────

    async getProfile(userId: string) {
        return this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                college: true,
                role: true,
                isVerified: true,
                createdAt: true,
                wallet: { select: { id: true, balance: true } },
            },
        });
    }
}
