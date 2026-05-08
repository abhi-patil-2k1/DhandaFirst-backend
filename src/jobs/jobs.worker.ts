import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobsService } from './jobs.service';
import { ReviewService } from '@/review/review.service';
import { AiReplyService } from '@/review/ai-reply.service';
import { PrismaService } from '@/common/prisma/prisma.service';
import { Job } from '@prisma/client';
import { randomUUID } from 'crypto';
import { BusinessSyncService } from '@/business/business-sync.service';

@Injectable()
export class JobsWorker {
  private readonly logger = new Logger(JobsWorker.name);
  private readonly workerId = `worker-${randomUUID().slice(0, 8)}`;

  constructor(
    private readonly jobsService: JobsService,
    private readonly reviewService: ReviewService,
    private readonly aiReplyService: AiReplyService,
    private readonly prisma: PrismaService,
    private readonly businessSyncService: BusinessSyncService,
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
        const updatedJob = await this.jobsService.failJob(job.id, message);
        await this.markJobFailure(job, updatedJob?.status ?? 'failed', message);
      }
    }
  }

  private async processJob(job: Job) {
    const payload = job.payload as Record<string, string>;

    switch (job.type) {
      case 'sync_business_initial':
        await this.businessSyncService.processInitialSync(job.userId, {
          businessId: payload.businessId,
          months: payload.months ? Number(payload.months) : undefined,
        });
        break;
      case 'sync_business_incremental':
        await this.businessSyncService.processIncrementalSync(job.userId, {
          businessId: payload.businessId,
        });
        break;
      case 'sync_reviews_page':
        await this.businessSyncService.processReviewPage(job.userId, {
          businessId: payload.businessId,
          mode: payload.mode as 'initial' | 'incremental',
          pageToken: payload.pageToken,
          stopAfterIso: payload.stopAfterIso,
        });
        break;
      case 'sync_posts_page':
        await this.businessSyncService.processPostPage(job.userId, {
          businessId: payload.businessId,
          mode: payload.mode as 'initial' | 'incremental',
          pageToken: payload.pageToken,
        });
        break;
      case 'sync_metrics_range':
        await this.businessSyncService.processMetricRange(job.userId, {
          businessId: payload.businessId,
          mode: payload.mode as 'initial' | 'incremental',
          startDate: payload.startDate,
          endDate: payload.endDate,
        });
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

  private async markJobFailure(job: Job, status: 'pending' | 'failed' | 'processing' | 'completed', message: string) {
    const payload = job.payload as Record<string, string>;
    const businessId = payload.businessId;

    if (!businessId) {
      return;
    }

    if (status !== 'failed') {
      await this.businessSyncService.recordRetryableSyncError(businessId, message);
      return;
    }

    switch (job.type) {
      case 'sync_business_initial':
        await this.businessSyncService.markSyncFailed(businessId, 'initial', message);
        break;
      case 'sync_reviews_page':
        await this.businessSyncService.markSyncFailed(businessId, 'reviews', message);
        break;
      case 'sync_posts_page':
        await this.businessSyncService.markSyncFailed(businessId, 'posts', message);
        break;
      case 'sync_metrics_range':
        await this.businessSyncService.markSyncFailed(businessId, 'metrics', message);
        break;
      default:
        break;
    }
  }
}
