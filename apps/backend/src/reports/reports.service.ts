import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async createReport(reporterId: string, reportedId: string, type: 'USER' | 'ITEM', reason: string) {
    return this.prisma.report.create({
      data: {
        reporterId,
        reportedId,
        type,
        reason,
        status: 'PENDING'
      }
    });
  }
}
