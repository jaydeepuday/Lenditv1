import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatService {
    constructor(private prisma: PrismaService) { }

    async createOrGetChat(itemId: string, renterId: string) {
        const item = await this.prisma.item.findUnique({
            where: { id: itemId },
            include: { owner: true }
        });

        if (!item) throw new NotFoundException('Item not found');
        if (item.ownerId === renterId) throw new ConflictException('You cannot chat with yourself about your own item');

        // Check if chat already exists
        let chat = await this.prisma.chat.findUnique({
            where: { itemId_renterId: { itemId, renterId } }
        });

        if (!chat) {
            chat = await this.prisma.chat.create({
                data: {
                    itemId,
                    renterId,
                    lenderId: item.ownerId,
                }
            });
        } else if (chat.isArchived) {
            chat = await this.prisma.chat.update({
                where: { id: chat.id },
                data: { isArchived: false, updatedAt: new Date() }
            });
        }

        return chat;
    }

    async getMyChats(userId: string) {
        const chats = await this.prisma.chat.findMany({
            where: {
                OR: [
                    { renterId: userId },
                    { lenderId: userId }
                ],
                isArchived: false,
            },
            include: {
                item: {
                    select: { id: true, title: true, images: true, category: true }
                },
                renter: {
                    select: { id: true, name: true, isVerified: true }
                },
                lender: {
                    select: { id: true, name: true, isVerified: true }
                },
                messages: {
                    orderBy: { sentAt: 'desc' },
                    take: 1
                }
            },
            orderBy: {
                updatedAt: 'desc'
            }
        });

        // Format to append unreadCount and lastMessage
        return chats.map(chat => {
            const lastMessage = chat.messages.length > 0 ? chat.messages[0] : null;
            // Removed 'messages' from output, map to lastMessage
            return {
                ...chat,
                lastMessage,
                messages: undefined,
            };
        });
    }

    async getChatDetails(chatId: string, userId: string) {
        const chat = await this.prisma.chat.findUnique({
            where: { id: chatId },
            include: {
                item: true,
                renter: {
                    select: { id: true, name: true, isVerified: true, college: true, createdAt: true, itemsListed: { select: { id: true } }, borrowsAsLender: { select: { id: true } }, borrowsAsRenter: { select: { id: true } } }
                },
                lender: {
                    select: { id: true, name: true, isVerified: true, college: true, createdAt: true, itemsListed: { select: { id: true } }, borrowsAsLender: { select: { id: true } }, borrowsAsRenter: { select: { id: true } } }
                }
            }
        });

        if (!chat) throw new NotFoundException('Chat not found');
        if (chat.renterId !== userId && chat.lenderId !== userId) {
            throw new ForbiddenException('Access denied to this chat');
        }

        // Find active or linked transaction to return
        // A single user->item relationship technically could have multiple transactions over time 
        // We will fetch the most relevant one (not cancelled if possible, or the most recent)
        const transaction = await this.prisma.borrowTransaction.findFirst({
            where: {
                itemId: chat.itemId,
                renterId: chat.renterId
            },
            orderBy: { createdAt: 'desc' }
        });

        // Compute trust signals for the OTHER user in the chat
        const isRenter = userId === chat.renterId;
        const otherUser = isRenter ? chat.lender : chat.renter;

        const trustSignals = {
            id: otherUser.id,
            name: otherUser.name,
            isVerified: otherUser.isVerified,
            college: otherUser.college,
            joinedAt: otherUser.createdAt,
            completedRentals: otherUser.borrowsAsLender.length + otherUser.borrowsAsRenter.length,
            // (Assuming ratings would go here in future)
            rating: 5.0
        };

        return {
            chat: {
                id: chat.id,
                itemId: chat.itemId,
                renterId: chat.renterId,
                lenderId: chat.lenderId,
                createdAt: chat.createdAt,
                updatedAt: chat.updatedAt,
                isArchived: chat.isArchived,
            },
            item: chat.item,
            partner: trustSignals,
            transaction: transaction || null
        };
    }
}
