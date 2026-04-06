import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { JobType } from '@prisma/client';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '@/common/decorators/current-user.decorator';
import { JobsService } from './jobs.service';

class CreateJobDto {
  @IsEnum(['fetch_reviews', 'generate_ai_reply', 'send_report'] as const)
  type: JobType;

  @IsOptional()
  payload?: Record<string, unknown>;
}

@ApiTags('jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  async createJob(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateJobDto,
  ) {
    const job = await this.jobsService.createJob(user.sub, dto.type, dto.payload);
    return { success: true, data: job };
  }

  @Get()
  async listJobs(
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.jobsService.getJobsByUser(
      user.sub,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
    return { success: true, ...result };
  }
}
