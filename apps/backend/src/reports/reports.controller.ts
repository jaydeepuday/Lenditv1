import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createReport(
    @CurrentUser() user: any,
    @Body('reportedId') reportedId: string,
    @Body('type') type: 'USER' | 'ITEM',
    @Body('reason') reason: string,
  ) {
    return this.reportsService.createReport(user.id || user.sub, reportedId, type, reason);
  }
}
