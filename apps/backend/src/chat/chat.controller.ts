import { Controller, Get, Post, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import { ChatService } from './chat.service';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
    constructor(private readonly chatService: ChatService) { }

    @Post()
    async createOrGetChat(
        @CurrentUser() user: any,
        @Body('itemId') itemId: string,
    ) {
        return this.chatService.createOrGetChat(itemId, user.id || user.sub);
    }

    @Get('my')
    async getMyChats(@CurrentUser() user: any) {
        return this.chatService.getMyChats(user.id || user.sub);
    }

    @Get(':id')
    async getChatDetails(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: any,
    ) {
        return this.chatService.getChatDetails(id, user.id || user.sub);
    }
}
