import {
    IsUUID,
    IsEnum,
    IsNumber,
    IsPositive,
    IsOptional,
    Min,
    Max,
    ValidateIf,
    IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DurationType, CampusLocation, RentalType } from '@prisma/client';

export class RequestBorrowDto {
    @IsUUID()
    itemId!: string;

    // ── Preset Rental Mode ────────────────────────────────────────────────────
    // When rentalType is supplied the service auto-computes times & pricing.
    // requestedStartTime / requestedEndTime become optional in that case.
    @IsOptional()
    @IsEnum(RentalType)
    rentalType?: RentalType;

    // Required only for EXAM_PASS — the actual exam window bounds
    @IsOptional()
    @IsString()
    examStart?: string;

    @IsOptional()
    @IsString()
    examEnd?: string;

    // ── Standard Hourly / Daily Mode ─────────────────────────────────────────
    @IsOptional()
    @IsEnum(DurationType)
    durationType?: DurationType;

    @IsOptional()
    @IsNumber()
    @IsPositive()
    @Type(() => Number)
    durationValue?: number;

    @IsOptional()
    @IsString()
    requestedStartTime?: string;

    @IsOptional()
    @IsString()
    requestedEndTime?: string;

    @IsOptional()
    @IsEnum(CampusLocation)
    pickupLocation?: CampusLocation;

    @IsOptional()
    @IsEnum(CampusLocation)
    returnLocation?: CampusLocation;
}

export class AcceptBorrowDto {
    @IsEnum(['ACCEPTED', 'REJECTED'])
    action!: 'ACCEPTED' | 'REJECTED';
}
