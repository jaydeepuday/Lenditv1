import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
    OnGatewayConnection,
    OnGatewayDisconnect,
    WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../auth/email.service';

interface AuthSocket extends Socket {
    userId?: string;
}

@WebSocketGateway({
    cors: {
        origin: true,       // reflect any origin — cookie auth manages security
        credentials: true,  // required for cookie transport
    },
    namespace: 'chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server!: Server;

    private readonly logger = new Logger(ChatGateway.name);

    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private configService: ConfigService,
        private emailService: EmailService,
    ) { }

    // ─── Connection Auth ─────────────────────────────────────────────────────

    async handleConnection(client: AuthSocket) {
        try {
            // 1. Try cookie first (browser clients using withCredentials)
            const cookieHeader = client.handshake.headers?.cookie || '';
            const cookieToken = cookieHeader
                .split(';')
                .map((c: string) => c.trim())
                .find((c: string) => c.startsWith('access_token='))
                ?.split('=')[1];

            // 2. Fall back to explicit auth token (non-browser / Postman)
            const token =
                cookieToken ||
                client.handshake.auth?.token ||
                client.handshake.headers?.authorization?.split(' ')[1];

            if (!token) throw new Error('No token provided');

            const payload = await this.jwtService.verifyAsync(token, {
                secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
            });

            const user = await this.prisma.user.findUnique({
                where: { id: payload.sub },
                select: { id: true, isVerified: true },
            });

            if (!user || !user.isVerified) throw new Error('Unauthorized');

            client.userId = user.id;
            client.join(`user:${user.id}`); // Global room for specific notifications
            this.logger.log(`Client connected: ${client.id} (user: ${user.id})`);
        } catch (err) {
            this.logger.warn(`Unauthorized WS connection: ${client.id}`);
            client.disconnect();
        }
    }

    handleDisconnect(client: AuthSocket) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    // ─── Join Chat Room ──────────────────────────────────────────────────────

    @SubscribeMessage('join-chat')
    async handleJoinChat(
        @MessageBody() data: { transactionId: string },
        @ConnectedSocket() client: AuthSocket,
    ) {
        const chat = await this.validateChatAccess(data.transactionId, client.userId!);
        client.join(`chat:${chat.id}`);

        // Send last 50 messages on join
        const messages = await this.prisma.message.findMany({
            where: { chatId: chat.id },
            orderBy: { sentAt: 'asc' },
            take: 50,
            include: { sender: { select: { id: true, name: true } } },
        });

        client.emit('chat-history', { chatId: chat.id, messages });
        return { chatId: chat.id };
    }

    // In-memory rate limiting (per userId per 60s)
    private recentMessages = new Map<string, { count: number; expiresAt: number }>();

    @SubscribeMessage('send-message')
    async handleMessage(
        @MessageBody() data: { transactionId: string; content: string },
        @ConnectedSocket() client: AuthSocket,
    ) {
        if (!data.content?.trim()) throw new WsException('Message content cannot be empty');
        if (data.content.length > 2000) throw new WsException('Message too long (max 2000 chars)');

        // 1. RATE LIMITING
        const now = Date.now();
        const stats = this.recentMessages.get(client.userId!);
        if (stats && stats.expiresAt > now) {
            if (stats.count > 20) throw new WsException('Slow down. You are sending messages too fast.');
            stats.count++;
        } else {
            this.recentMessages.set(client.userId!, { count: 1, expiresAt: now + 60000 });
        }

        const chat = await this.validateChatAccess(data.transactionId, client.userId!);

        // 2. NORMALIZATION & BYPASS FILTER
        const normalized = data.content
            .normalize('NFKD') // Decompose combined characters
            .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
            .toLowerCase();

        const phoneRegex = /\b(\d[\s-]?){8,12}\b/;
        const upiRegex = /\b[\w.-]+@(upi|ybl|okaxis|okhdfc|paytm)\b/i;
        const socialRegex = /(instagram|insta|snap|snapchat|telegram|whatsapp|call me|text me)/i;

        if (phoneRegex.test(normalized) || upiRegex.test(normalized) || socialRegex.test(normalized)) {
            this.logger.warn(`Blocked contact sharing attempt from user ${client.userId} (normalized: ${normalized})`);
            data.content = "⚠️ For your safety, contact sharing is blocked until payment";
        }

        if (chat.transaction.status === 'REQUESTED' || chat.transaction.status === 'ACCEPTED') {
            const SAFE_PINGS = [
                "is this available?",
                "is this available right now?",
                "is this still available?",
                "where is pickup?",
                "what is the condition?",
                "when can i collect?"
            ];
            
            if (!SAFE_PINGS.includes(normalized)) {
                throw new WsException('Complete payment to unlock full chat. Only pre-defined questions are allowed.');
            }
        }

        const message = await this.prisma.message.create({
            data: {
                chatId: chat.id,
                senderId: client.userId!,
                content: data.content.trim(),
            },
            include: { sender: { select: { id: true, name: true } } },
        });

        // Broadcast to EVERYONE in the room (including sender, so they see it instantly in UI)
        this.server.to(`chat:${chat.id}`).emit('new-message', message);

        // Send real-time UI notification to the OTHER user's personal room
        const recipientId = chat.transaction.renterId === client.userId! ? chat.transaction.lenderId : chat.transaction.renterId;
        this.server.to(`user:${recipientId}`).emit('notification', {
            title: `New message from ${message.sender.name}`,
            body: message.content,
            link: `#/chat/${chat.transactionId}`
        });

        // Send email notification to the recipient
        const recipient = await this.prisma.user.findUnique({ where: { id: recipientId } });
        
        if (recipient) {
             this.emailService.sendNotificationEmail(
                 recipient.email,
                 `New Message from ${message.sender.name} - LendIT`,
                 `New Message from ${message.sender.name}`,
                 `You received a new message regarding your rental:\n\n"${message.content}"\n\nPlease log in to the LendIT platform to reply.`
             ).catch(err => this.logger.error('Failed to send message notification', err));
        }

        return message; // This acts as an acknowledgment to the sender
    }

    // ─── Access Control ──────────────────────────────────────────────────────

    private async validateChatAccess(transactionId: string, userId: string) {
        const chat = await this.prisma.chat.findUnique({
            where: { transactionId },
            include: { transaction: { select: { renterId: true, lenderId: true, status: true } } },
        });

        if (!chat) {
             this.logger.warn(`Chat not found for transaction: ${transactionId}`);
             throw new WsException('Chat not found');
        }

        const isParty =
            chat.transaction.renterId === userId || chat.transaction.lenderId === userId;
            
        if (!isParty) {
            this.logger.warn(`Access denied! user=${userId}, renter=${chat.transaction.renterId}, lender=${chat.transaction.lenderId}`);
            throw new WsException('Access denied');
        }

        return chat;
    }
}
