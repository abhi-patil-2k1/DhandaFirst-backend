import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { type JobType, type JobStatus } from '@prisma/client';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createJob(
    userId: string,
    type: JobType,
    payload: Record<string, unknown> = {},
    maxAttempts = 3,
  ) {
    return this.prisma.job.create({
      data: {
        userId,
        type,
        payload: JSON.parse(JSON.stringify(payload)),
        maxAttempts,
      },
    });
  }

  async claimPendingJobs(workerId: string, limit = 5) {
    // Atomic claim: find pending jobs and lock them
    const jobs = await this.prisma.job.findMany({
      where: {
        status: 'pending',
        lockedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    if (jobs.length === 0) return [];

    const claimed = [];
    for (const job of jobs) {
      try {
        // Optimistic lock — only update if still pending and unlocked
        const updated = await this.prisma.job.updateMany({
          where: {
            id: job.id,
            status: 'pending',
            lockedAt: null,
          },
          data: {
            status: 'processing',
            lockedAt: new Date(),
            lockedBy: workerId,
            attempts: { increment: 1 },
          },
        });
        if (updated.count > 0) {
          claimed.push(
            await this.prisma.job.findUnique({ where: { id: job.id } }),
          );
        }
      } catch (error) {
        this.logger.warn(`Failed to claim job ${job.id}`, error);
      }
    }

    return claimed.filter(Boolean);
  }

  async completeJob(jobId: string, result?: Record<string, unknown>) {
    return this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        result: result ? JSON.parse(JSON.stringify(result)) : undefined,
        processedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      },
    });
  }

  async failJob(jobId: string, error: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return;

    const newStatus: JobStatus =
      job.attempts >= job.maxAttempts ? 'failed' : 'pending';

    return this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: newStatus,
        error,
        lockedAt: null,
        lockedBy: null,
      },
    });
  }

  async getJobsByUser(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.job.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.job.count({ where: { userId } }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // Clean up stale locks (jobs stuck in processing for > 5 minutes)
  async cleanStaleLocks() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const result = await this.prisma.job.updateMany({
      where: {
        status: 'processing',
        lockedAt: { lt: fiveMinutesAgo },
      },
      data: {
        status: 'pending',
        lockedAt: null,
        lockedBy: null,
      },
    });
    if (result.count > 0) {
      this.logger.warn(`Released ${result.count} stale job locks`);
    }
  }
}
