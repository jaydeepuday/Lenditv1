import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsNumber,
    IsPositive,
    IsArray,
    IsEnum,
    Min,
    Max,
    ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ItemCategory {
    ELECTRONICS = 'ELECTRONICS',
    BOOKS = 'BOOKS',
    SPORTS = 'SPORTS',
    CLOTHING = 'CLOTHING',
    TOOLS = 'TOOLS',
    STATIONERY = 'STATIONERY',
    KITCHEN = 'KITCHEN',
    OTHER = 'OTHER',
}

export class CreateItemDto {
    @IsString()
    @IsNotEmpty()
    title!: string;

    @IsString()
    @IsNotEmpty()
    description!: string;

    @IsEnum(ItemCategory)
    category!: string;

    @IsArray()
    @IsOptional()
    images?: string[];

    @IsOptional()
    @IsNumber()
    @IsPositive()
    @Type(() => Number)
    pricePerHour?: number;

    @IsOptional()
    @IsNumber()
    @IsPositive()
    @Type(() => Number)
    pricePerDay?: number;

    // maxHours capped at 12 server-side even if client sends more
    @ValidateIf((o) => o.pricePerHour !== undefined)
    @IsNumber()
    @Min(1)
    @Max(12)
    @Type(() => Number)
    maxHours?: number;
}

export class UpdateItemDto {
    @IsOptional()
    @IsString()
    title?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsEnum(ItemCategory)
    category?: string;

    @IsOptional()
    @IsArray()
    images?: string[];

    @IsOptional()
    @IsNumber()
    @IsPositive()
    @Type(() => Number)
    pricePerHour?: number;

    @IsOptional()
    @IsNumber()
    @IsPositive()
    @Type(() => Number)
    pricePerDay?: number;

    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(12)
    @Type(() => Number)
    maxHours?: number;
}

export class ItemFilterDto {
    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsEnum(ItemCategory)
    category?: string;

    @IsOptional()
    @IsEnum(['HOURS', 'DAYS', 'BOTH'])
    durationType?: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @IsPositive()
    minPrice?: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @IsPositive()
    maxPrice?: number;

    @IsOptional()
    @Type(() => Number)
    page?: number = 1;

    @IsOptional()
    @Type(() => Number)
    limit?: number = 20;
}
