import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
    private readonly logger = new Logger(EmailService.name);
    private resendClient: Resend | null = null;
    private readonly fallbackMode: boolean;

    constructor(private configService: ConfigService) {
        const apiKey = this.configService.get<string>('RESEND_API_KEY');
        if (apiKey) {
            this.resendClient = new Resend(apiKey);
            this.fallbackMode = false;
            this.logger.log('Email provider: Resend');
        } else {
            this.fallbackMode = true;
            this.logger.warn('Email provider disabled - console fallback active');
        }
    }

    private async sendWithTimeout(payload: any): Promise<any> {
        if (!this.resendClient) return;

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Email provider timeout (5s)')), 5000)
        );

        return Promise.race([
            this.resendClient.emails.send(payload),
            timeoutPromise
        ]);
    }

    async sendOtpEmail(to: string, otp: string, name: string): Promise<void> {
        const from = this.configService.get<string>('EMAIL_FROM', 'lendIT <onboarding@resend.dev>');

        if (this.fallbackMode) {
            this.logger.warn(`[DEV MODE] OTP for ${to}: ${otp}`);
            return;
        }

        const htmlBody = `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: Arial, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px;">
          <div style="max-width: 480px; margin: 0 auto; background: #1a1a1a; border-radius: 12px; padding: 32px; border: 1px solid #2a2a2a;">
            <h1 style="color: #a855f7; font-size: 28px; margin: 0 0 8px;">lendIT</h1>
            <p style="color: #888; margin: 0 0 32px; font-size: 14px;">Campus Item Lending Platform</p>
            <h2 style="color: #e5e5e5; font-size: 20px; margin: 0 0 16px;">Verify your email</h2>
            <p style="color: #aaa; margin: 0 0 24px;">Hi ${name}, here is your one-time verification code:</p>
            <div style="background: #111; border: 2px solid #a855f7; border-radius: 8px; padding: 20px; text-align: center; margin: 0 0 24px;">
              <span style="font-size: 40px; font-weight: 700; letter-spacing: 12px; color: #a855f7; font-family: monospace;">${otp}</span>
            </div>
            <p style="color: #888; font-size: 13px; margin: 0 0 8px;">⏱ This code expires in <strong style="color: #e5e5e5;">5 minutes</strong>.</p>
            <p style="color: #888; font-size: 13px; margin: 0;">🔒 Do not share this code with anyone.</p>
          </div>
        </body>
      </html>
    `;

        try {
            const { error } = await this.sendWithTimeout({
                from,
                to,
                subject: `${otp} — Your lendIT Verification Code`,
                html: htmlBody,
                text: `Your lendIT OTP is: ${otp}. It expires in 5 minutes.`,
            });
            
            if (error) {
                throw new Error(error.message);
            }
            
            this.logger.log(`OTP email sent to ${to}`);
        } catch (error) {
            this.logger.error(`Failed to send OTP email to ${to}`, error);
            throw error; // Let caller handle the exception
        }
    }

    async sendNotificationEmail(to: string, subject: string, title: string, message: string): Promise<void> {
        const from = this.configService.get<string>('EMAIL_FROM', 'lendIT <onboarding@resend.dev>');

        if (this.fallbackMode) {
            this.logger.warn(`[DEV MODE] Notification to ${to} | ${subject}: ${message}`);
            return;
        }

        const htmlBody = `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: Arial, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px;">
          <div style="max-width: 480px; margin: 0 auto; background: #1a1a1a; border-radius: 12px; padding: 32px; border: 1px solid #2a2a2a;">
            <h1 style="color: #a855f7; font-size: 28px; margin: 0 0 8px;">lendIT</h1>
            <p style="color: #888; margin: 0 0 32px; font-size: 14px;">Campus Item Lending Platform</p>
            <h2 style="color: #e5e5e5; font-size: 20px; margin: 0 0 16px;">${title}</h2>
            <p style="color: #aaa; margin: 0 0 24px; white-space: pre-wrap;">${message}</p>
            <p style="color: #888; font-size: 13px; margin: 0 0 8px;">Log in to lendIT to view details.</p>
          </div>
        </body>
      </html>
    `;

        try {
            const { error } = await this.sendWithTimeout({
                from,
                to,
                subject,
                html: htmlBody,
                text: message,
            });
            
            if (error) {
                throw new Error(error.message);
            }
            
            this.logger.log(`Notification email sent to ${to}`);
        } catch (error) {
            this.logger.error(`Failed to send notification email to ${to}`, error);
        }
    }
}

