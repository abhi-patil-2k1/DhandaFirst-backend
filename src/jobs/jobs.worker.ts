import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobsService } from './jobs.service';
import { ReviewService } from '@/review/review.service';
import { AiReplyService } from '@/review/ai-reply.service';
import { PrismaService } from '@/common/prisma/prisma.service';
import { Job } from '@prisma/client';
import { randomUUID } from 'crypto';

@Injectable()
export class JobsWorker {
  private readonly logger = new Logger(JobsWorker.name);
  private readonly workerId = `worker-${randomUUID().slice(0, 8)}`;

  constructor(
    private readonly jobsService: JobsService,
    private readonly reviewService: ReviewService,
    private readonly aiReplyService: AiReplyService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processJobs() {
    // Clean stale locks first
    await this.jobsService.cleanStaleLocks();

    const jobs = await this.jobsService.claimPendingJobs(this.workerId);
    if (jobs.length === 0) return;

    this.logger.log(`Processing ${jobs.length} jobs`);

    for (const job of jobs) {
      if (!job) continue;
      try {
        await this.processJob(job);
        await this.jobsService.completeJob(job.id, { processedBy: this.workerId });
        this.logger.log(`Job ${job.id} (${job.type}) completed`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Job ${job.id} (${job.type}) failed: ${message}`);
        await this.jobsService.failJob(job.id, message);
      }
    }
  }

  private async processJob(job: Job) {
    const payload = job.payload as Record<string, string>;

    switch (job.type) {
      case 'fetch_reviews':
        await this.handleFetchReviews(job.userId, payload.businessId);
        break;
      case 'generate_ai_reply':
        await this.handleGenerateAiReply(job.userId, payload.reviewId);
        break;
      case 'send_report':
        await this.handleSendReport(job.userId, payload);
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  private async handleFetchReviews(userId: string, businessId: string) {
    await this.reviewService.syncReviews(userId, businessId);
  }

  private async handleGenerateAiReply(userId: string, reviewId: string) {
    const review = await this.reviewService.getReviewById(userId, reviewId);
    const reply = await this.aiReplyService.generateReply(
      review.business.name,
      review.authorName,
      review.rating,
      review.comment ?? '',
    );
    await this.reviewService.saveAiSuggestedReply(reviewId, reply);
  }

  private async handleSendReport(_userId: string, payload: Record<string, string>) {
    // Placeholder for report generation
    this.logger.log(`Report job triggered with payload: ${JSON.stringify(payload)}`);
  }
}
