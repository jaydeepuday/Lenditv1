import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    HttpCode,
    HttpStatus,
    ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, Public } from '../common/decorators';
import { ItemsService } from './items.service';
import { CreateItemDto, UpdateItemDto, ItemFilterDto } from './dto/items.dto';

@Controller('items')
@UseGuards(JwtAuthGuard)
export class ItemsController {
    constructor(private readonly itemsService: ItemsService) { }

    @Post()
    async create(
        @CurrentUser('id') userId: string,
        @Body() dto: CreateItemDto,
    ) {
        return this.itemsService.create(userId, dto);
    }

    @Public()
    @Get()
    async findAll(@Query() filters: ItemFilterDto) {
        return this.itemsService.findAll(filters);
    }

    @Get('my')
    async findMyItems(@CurrentUser('id') userId: string) {
        return this.itemsService.findMyItems(userId);
    }

    @Public()
    @Get(':id')
    async findOne(@Param('id', ParseUUIDPipe) id: string) {
        return this.itemsService.findOne(id);
    }

    @Patch(':id')
    async update(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser('id') userId: string,
        @Body() dto: UpdateItemDto,
    ) {
        return this.itemsService.update(id, userId, dto);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    async remove(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser('id') userId: string,
    ) {
        return this.itemsService.remove(id, userId);
    }

    @Patch(':id/toggle-availability')
    async toggleAvailability(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser('id') userId: string,
    ) {
        return this.itemsService.toggleAvailability(id, userId);
    }
}
