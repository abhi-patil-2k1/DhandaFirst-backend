import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '@/common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  async getStats(
    @CurrentUser() user: JwtPayload,
    @Query('businessId') businessId?: string,
    @Query('months') months?: string,
  ) {
    const stats = await this.dashboardService.getStats(
      user.sub,
      businessId,
      months ? parseInt(months, 10) : undefined,
    );
    return { success: true, data: stats };
  }

  @Get('metrics')
  async getMetrics(
    @CurrentUser() user: JwtPayload,
    @Query('businessId') businessId: string,
    @Query('months') months?: string,
  ) {
    const metrics = await this.dashboardService.getPerformanceMetrics(
      user.sub,
      businessId,
      months ? parseInt(months, 10) : undefined,
    );
    return { success: true, data: metrics };
  }
}
