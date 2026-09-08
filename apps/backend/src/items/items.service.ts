import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateItemDto, UpdateItemDto, ItemFilterDto } from './dto/items.dto';

@Injectable()
export class ItemsService {
    constructor(private prisma: PrismaService) { }

    async create(ownerId: string, dto: CreateItemDto) {
        if (!dto.pricePerHour && !dto.pricePerDay) {
            throw new BadRequestException('Item must have at least one pricing option (hourly or daily)');
        }

        // Hard cap maxHours at 12 regardless of client input
        const maxHours = dto.pricePerHour
            ? Math.min(dto.maxHours ?? 12, 12)
            : undefined;

        const availableFrom = new Date(dto.availableFrom);
        const availableUntil = new Date(dto.availableUntil);

        if (isNaN(availableFrom.getTime()) || isNaN(availableUntil.getTime())) {
            throw new BadRequestException('Invalid date format for availability window');
        }

        if (availableUntil <= availableFrom) {
            throw new BadRequestException('availableUntil must be strictly later than availableFrom');
        }

        return this.prisma.item.create({
            data: {
                ownerId,
                title: dto.title,
                description: dto.description,
                category: dto.category,
                images: dto.images ?? [],
                pricePerHour: dto.pricePerHour,
                pricePerDay: dto.pricePerDay,
                maxHours,
                isAvailable: true,
                isActive: true,
                availableFrom,
                availableUntil,
            },
            include: {
                owner: { select: { id: true, name: true, college: true } },
            },
        });
    }

    async findAll(filters: ItemFilterDto) {
        const page = Math.max(1, filters.page ?? 1);
        const limit = Math.min(50, filters.limit ?? 20); // cap at 50
        const skip = (page - 1) * limit;

        const where: any = {
            isActive: true,
            isAvailable: true,
            availableFrom: { lte: new Date() },
            availableUntil: { gte: new Date() },
        };

        if (filters.search) {
            where.OR = [
                { title: { contains: filters.search, mode: 'insensitive' } },
                { description: { contains: filters.search, mode: 'insensitive' } },
                { category: { contains: filters.search, mode: 'insensitive' } },
            ];
        }

        if (filters.category) {
            where.category = filters.category;
        }

        if (filters.durationType === 'HOURS') {
            where.pricePerHour = { not: null };
        } else if (filters.durationType === 'DAYS') {
            where.pricePerDay = { not: null };
        }

        const [items, total] = await Promise.all([
            this.prisma.item.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    title: true,
                    description: true,
                    category: true,
                    pricePerHour: true,
                    pricePerDay: true,
                    maxHours: true,
                    isAvailable: true,
                    availableFrom: true,
                    availableUntil: true,
                    createdAt: true,
                    // OPTIMIZATION: Omitting images from DB query to prevent massive Base64 memory bloat
                    owner: { select: { id: true, name: true, college: true } },
                },
            }),
            this.prisma.item.count({ where }),
        ]);

        // Do not return Base64 array. Just return metadata and a boolean placeholder.
        const mappedItems = items.map((item) => ({
            ...item,
            hasImage: false, // Statically set for the listing constraint
        }));

        return {
            items: mappedItems,
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }

    async findOne(id: string) {
        const item = await this.prisma.item.findFirst({
            where: { id, isActive: true },
            include: {
                owner: { select: { id: true, name: true, college: true } },
            },
        });

        if (!item) throw new NotFoundException('Item not found');
        return item;
    }

    async findMyItems(ownerId: string) {
        const items = await this.prisma.item.findMany({
            where: { ownerId, isActive: true },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                title: true,
                description: true,
                category: true,
                pricePerHour: true,
                pricePerDay: true,
                maxHours: true,
                isAvailable: true,
                isActive: true,
                availableFrom: true,
                availableUntil: true,
                createdAt: true,
                images: true,  // fetched only to compute hasImage
            },
        });
        return items.map(({ images, ...item }) => ({
            ...item,
            hasImage: images.length > 0,
        }));
    }

    async update(id: string, ownerId: string, dto: UpdateItemDto) {
        await this.assertOwner(id, ownerId);

        // Check if item has active borrow - cannot edit during active rental
        const activeBorrow = await this.prisma.borrowTransaction.findFirst({
            where: {
                itemId: id,
                status: { in: ['REQUESTED', 'ACCEPTED', 'ACTIVE', 'GRACE'] },
            },
        });

        if (activeBorrow) {
            throw new ForbiddenException('Cannot edit item while it has an active or pending rental');
        }

        const maxHours = dto.pricePerHour !== undefined
            ? Math.min(dto.maxHours ?? 12, 12)
            : dto.maxHours;

        const updateData: any = { ...dto, maxHours };

        if (dto.availableFrom) updateData.availableFrom = new Date(dto.availableFrom);
        if (dto.availableUntil) updateData.availableUntil = new Date(dto.availableUntil);

        if (updateData.availableFrom && updateData.availableUntil) {
            if (updateData.availableUntil <= updateData.availableFrom) {
                throw new BadRequestException('availableUntil must be strictly later than availableFrom');
            }
        }

        return this.prisma.item.update({
            where: { id },
            data: updateData,
        });
    }

    async remove(id: string, ownerId: string) {
        await this.assertOwner(id, ownerId);

        const activeBorrow = await this.prisma.borrowTransaction.findFirst({
            where: {
                itemId: id,
                status: { in: ['REQUESTED', 'ACCEPTED', 'ACTIVE', 'GRACE'] },
            },
        });

        if (activeBorrow) {
            throw new ForbiddenException('Cannot delete item with an active rental in progress');
        }

        // Soft delete
        return this.prisma.item.update({
            where: { id },
            data: { isActive: false },
        });
    }

    async toggleAvailability(id: string, ownerId: string) {
        const item = await this.assertOwner(id, ownerId);
        return this.prisma.item.update({
            where: { id },
            data: { isAvailable: !item.isAvailable },
        });
    }

    private async assertOwner(id: string, ownerId: string) {
        const item = await this.prisma.item.findFirst({ where: { id, isActive: true } });
        if (!item) throw new NotFoundException('Item not found');
        if (item.ownerId !== ownerId) throw new ForbiddenException('You do not own this item');
        return item;
    }
}
