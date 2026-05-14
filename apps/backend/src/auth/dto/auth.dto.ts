import { IsEmail, IsString, MinLength, IsNotEmpty, Matches } from 'class-validator';

// ─── Student Email Validation ───────────────────────────────────────────────
// Allowlist-based: only known academic TLDs and patterns are accepted
// This is the first line of defense; backend AuthService adds domain-level checks

const STUDENT_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(edu|ac\.in|edu\.in|ac\.uk|edu\.au|ac\.nz|edu\.sg|edu\.my|ac\.za|edu\.ph)$/i;

const BLOCKED_DOMAINS = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
    'live.com', 'icloud.com', 'me.com', 'mac.com',
    'protonmail.com', 'tutanota.com', 'aol.com', 'rediffmail.com',
    'ymail.com', 'zoho.com', 'gmx.com', 'mail.com',
];

export const ALLOWED_UNIVERSITIES = [
    { id: 'woxsen', name: 'Woxsen University' },
];

export function isStudentEmail(email: string): boolean {
    if (!email) return false;
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return false;

    // Block known free email providers
    if (BLOCKED_DOMAINS.includes(domain)) return false;

    // Must match academic TLD pattern
    return STUDENT_EMAIL_REGEX.test(email);
}

export class SignupDto {
    @Matches(/@[a-zA-Z0-9.-]+\.(edu|edu\.in|ac\.in)$/i, {
        message: 'Must be a valid institutional email (.edu, .edu.in, or .ac.in)',
    })
    email!: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
        message: 'Password too weak',
    })
    password!: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(2, { message: 'Name must be at least 2 characters' })
    name!: string;

    @IsString()
    @IsNotEmpty()
    @Matches(/^(Woxsen University)$/, {
        message: 'Please select a valid university from the list',
    })
    college!: string;
}

export class VerifyOtpDto {
    @IsEmail()
    email!: string;

    @IsString()
    @Matches(/^\d{6}$/, { message: 'OTP must be a 6-digit number' })
    otp!: string;
}

export class ResendOtpDto {
    @IsEmail()
    @IsNotEmpty()
    email!: string;
}

export class LoginDto {
    @IsEmail()
    @IsNotEmpty()
    email!: string;

    @IsString()
    @IsNotEmpty()
    password!: string;
}
