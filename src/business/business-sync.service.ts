import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { JobStatus, SyncStatus } from '@prisma/client';
import { PrismaService } from '@/common/prisma/prisma.service';
import { JobsService } from '@/jobs/jobs.service';
import { BusinessService } from './business.service';
import { GoogleBusinessService } from './google-business.service';
import {
  DEFAULT_METRIC_SYNC_MONTHS,
  GBP_DAILY_METRICS,
  METRIC_SYNC_CHUNK_DAYS,
  POST_SYNC_PAGE_SIZE,
  REVIEW_SYNC_PAGE_SIZE,
} from './business-sync.constants';

type SyncMode = 'initial' | 'incremental';

interface StartBusinessSyncOptions {
  months?: number;
}

interface ReviewPageJobPayload {
  businessId: string;
  mode: SyncMode;
  pageToken?: string;
  stopAfterIso?: string;
}

interface PostPageJobPayload {
  businessId: string;
  mode: SyncMode;
  pageToken?: string;
}

interface MetricRangeJobPayload {
  businessId: string;
  mode: SyncMode;
  startDate: string;
  endDate: string;
}

@Injectable()
export class BusinessSyncService {
  private readonly logger = new Logger(BusinessSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => JobsService))
    private readonly jobsService: JobsService,
    private readonly businessService: BusinessService,
    private readonly googleBusiness: GoogleBusinessService,
  ) {}

  async ensureSyncState(businessId: string, initialMonths = DEFAULT_METRIC_SYNC_MONTHS) {
    return this.prisma.businessSyncState.upsert({
      where: { businessId },
      update: {},
      create: {
        businessId,
        initialSyncMonths: initialMonths,
      },
    });
  }

  async startInitialSync(
    userId: string,
    businessId: string,
    options: StartBusinessSyncOptions = {},
  ) {
    const business = await this.businessService.getBusinessById(userId, businessId);
    const months = this.normalizeMonths(options.months);

    await this.ensureSyncState(business.id, months);
    await this.prisma.businessSyncState.update({
      where: { businessId: business.id },
      data: {
        initialSyncStatus: 'syncing',
        reviewsSyncStatus: 'pending',
        postsSyncStatus: 'pending',
        metricsSyncStatus: 'pending',
        initialSyncMonths: months,
        lastError: null,
      },
    });

    return this.jobsService.createJob(
      userId,
      'sync_business_initial',
      { businessId: business.id, months },
      {
        dedupeKey: `sync_business_initial:${business.id}`,
      },
    );
  }

  async startIncrementalSync(userId: string, businessId: string) {
    const business = await this.businessService.getBusinessById(userId, businessId);
    const syncState = await this.ensureSyncState(business.id);

    if (syncState.initialSyncStatus === 'syncing') {
      throw new BadRequestException('Initial sync is still running for this business');
    }

    return this.jobsService.createJob(
      userId,
      'sync_business_incremental',
      { businessId: business.id },
      {
        dedupeKey: `sync_business_incremental:${business.id}`,
      },
    );
  }

  async getSyncStatus(userId: string, businessId: string) {
    await this.businessService.getBusinessById(userId, businessId);

    const [syncState, activeJobs] = await Promise.all([
      this.ensureSyncState(businessId),
      this.prisma.job.findMany({
        where: {
          userId,
          status: { in: ['pending', 'processing'] },
          payload: {
            path: ['businessId'],
            equals: businessId,
          },
        },
        orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    return {
      ...syncState,
      activeJobs: activeJobs.map((job) => ({
        id: job.id,
        type: job.type,
        status: job.status,
        runAt: job.runAt,
        attempts: job.attempts,
        createdAt: job.createdAt,
      })),
    };
  }

  async listPosts(
    userId: string,
    businessId: string,
    query: { months?: number; page?: number; limit?: number },
  ) {
    await this.businessService.getBusinessById(userId, businessId);

    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const where: Record<string, unknown> = { businessId };

    if (query.months) {
      where.OR = [
        { publishedAt: { gte: this.monthsAgo(query.months) } },
        { updatedAtSource: { gte: this.monthsAgo(query.months) } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.businessPost.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { updatedAtSource: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.businessPost.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getMetricSummary(
    userId: string,
    businessId: string,
    months = DEFAULT_METRIC_SYNC_MONTHS,
  ) {
    await this.businessService.getBusinessById(userId, businessId);

    const startDate = this.monthsAgo(this.normalizeMonths(months));
    const metrics = await this.prisma.businessMetricDaily.findMany({
      where: {
        businessId,
        date: { gte: startDate },
      },
      orderBy: [{ metric: 'asc' }, { date: 'asc' }],
    });

    const byMetric = new Map<string, { total: number; points: { date: string; value: number }[] }>();
    for (const row of metrics) {
      const entry = byMetric.get(row.metric) ?? { total: 0, points: [] };
      entry.total += row.value;
      entry.points.push({
        date: row.date.toISOString().split('T')[0],
        value: row.value,
      });
      byMetric.set(row.metric, entry);
    }

    return Array.from(byMetric.entries()).map(([metric, value]) => ({
      metric,
      total: value.total,
      series: value.points,
    }));
  }

  async processInitialSync(userId: string, payload: { businessId: string; months?: number }) {
    const months = this.normalizeMonths(payload.months);
    await this.enqueueReviewSync(userId, payload.businessId, 'initial');
    await this.enqueuePostSync(userId, payload.businessId, 'initial');
    await this.enqueueMetricSync(userId, payload.businessId, 'initial', months);
  }

  async processIncrementalSync(userId: string, payload: { businessId: string }) {
    const syncState = await this.ensureSyncState(payload.businessId);

    await this.prisma.businessSyncState.update({
      where: { businessId: payload.businessId },
      data: {
        reviewsSyncStatus: syncState.reviewsBackfilledAt ? 'syncing' : syncState.reviewsSyncStatus,
        postsSyncStatus: syncState.postsBackfilledAt ? 'syncing' : syncState.postsSyncStatus,
        metricsSyncStatus: syncState.metricsBackfilledAt ? 'syncing' : syncState.metricsSyncStatus,
        lastError: null,
      },
    });

    // TODO: Tighten the review incremental stop condition further so we can
    // short-circuit earlier and reduce API usage on high-volume locations.
    await this.enqueueReviewSync(
      userId,
      payload.businessId,
      'incremental',
      syncState.lastReviewSyncAt?.toISOString(),
    );

    // TODO: Make posts sync truly incremental using lastPostSyncAt and/or a
    // persisted page cursor instead of replaying all pages in incremental mode.
    await this.enqueuePostSync(userId, payload.businessId, 'incremental');

    // TODO: Make metrics sync truly incremental using lastMetricSyncAt plus a
    // small rolling refresh window instead of re-fetching the full configured range.
    await this.enqueueMetricSync(
      userId,
      payload.businessId,
      'incremental',
      syncState.initialSyncMonths || DEFAULT_METRIC_SYNC_MONTHS,
    );
  }

  async processReviewPage(userId: string, payload: ReviewPageJobPayload) {
    const business = await this.businessService.getBusinessById(userId, payload.businessId);
    const locationName = `${business.googleAccountId}/locations/${business.googleLocationId}`;
    const stopAfter = payload.stopAfterIso ? new Date(payload.stopAfterIso) : null;

    const response = await this.googleBusiness.listReviewsPage(
      userId,
      locationName,
      payload.pageToken,
      REVIEW_SYNC_PAGE_SIZE,
    );

    const reviews = response.reviews ?? [];
    let shouldContinue = Boolean(response.nextPageToken);
    let newestSeenAt: Date | null = null;

    for (const review of reviews) {
      const sourceUpdatedAt = new Date(review.updateTime ?? review.createTime ?? Date.now());
      if (!newestSeenAt || sourceUpdatedAt > newestSeenAt) {
        newestSeenAt = sourceUpdatedAt;
      }

      await this.prisma.review.upsert({
        where: { googleReviewId: review.reviewId ?? review.name },
        update: {
          authorName: review.reviewer?.displayName ?? 'Anonymous',
          authorPhotoUrl: review.reviewer?.profilePhotoUrl,
          rating: review.starRating ? this.starRatingToNumber(review.starRating) : 0,
          comment: review.comment,
          replyComment: review.reviewReply?.comment,
          repliedAt: review.reviewReply?.updateTime
            ? new Date(review.reviewReply.updateTime)
            : null,
          reviewedAt: new Date(review.createTime ?? review.updateTime ?? Date.now()),
        },
        create: {
          businessId: business.id,
          googleReviewId: review.reviewId ?? review.name,
          authorName: review.reviewer?.displayName ?? 'Anonymous',
          authorPhotoUrl: review.reviewer?.profilePhotoUrl,
          rating: review.starRating ? this.starRatingToNumber(review.starRating) : 0,
          comment: review.comment,
          replyComment: review.reviewReply?.comment,
          repliedAt: review.reviewReply?.updateTime
            ? new Date(review.reviewReply.updateTime)
            : null,
          reviewedAt: new Date(review.createTime ?? review.updateTime ?? Date.now()),
        },
      });
    }

    if (stopAfter && reviews.length > 0) {
      const oldestSeenAt = new Date(
        reviews[reviews.length - 1].updateTime ??
          reviews[reviews.length - 1].createTime ??
          Date.now(),
      );
      if (oldestSeenAt <= stopAfter) {
        shouldContinue = false;
      }
    }

    if (shouldContinue && response.nextPageToken) {
      await this.jobsService.createJob(
        userId,
        'sync_reviews_page',
        {
          businessId: business.id,
          mode: payload.mode,
          pageToken: response.nextPageToken,
          stopAfterIso: payload.stopAfterIso,
        } satisfies ReviewPageJobPayload,
        {
          dedupeKey: `sync_reviews_page:${business.id}:${payload.mode}:${response.nextPageToken}`,
        },
      );
      return;
    }

    await this.refreshBusinessReviewStats(business.id);
    await this.prisma.businessSyncState.update({
      where: { businessId: business.id },
      data: {
        reviewsSyncStatus: 'completed',
        lastReviewSyncAt: newestSeenAt ?? new Date(),
        reviewsBackfilledAt:
          payload.mode === 'initial' ? new Date() : undefined,
      },
    });
    await this.refreshInitialSyncStatus(business.id);
  }

  async processPostPage(userId: string, payload: PostPageJobPayload) {
    const business = await this.businessService.getBusinessById(userId, payload.businessId);
    const locationName = `${business.googleAccountId}/locations/${business.googleLocationId}`;
    const response = await this.googleBusiness.listLocalPostsPage(
      userId,
      locationName,
      payload.pageToken,
      POST_SYNC_PAGE_SIZE,
    );

    let newestSeenAt: Date | null = null;
    for (const post of response.localPosts ?? []) {
      const updatedAtSource = post.updateTime ? new Date(post.updateTime) : null;
      const publishedAt = post.createTime ? new Date(post.createTime) : null;

      if (updatedAtSource && (!newestSeenAt || updatedAtSource > newestSeenAt)) {
        newestSeenAt = updatedAtSource;
      }

      await this.prisma.businessPost.upsert({
        where: { googlePostId: post.name },
        update: {
          languageCode: post.languageCode,
          summary: post.summary,
          topicType: post.topicType,
          state: post.state,
          searchUrl: post.searchUrl,
          callToActionType: post.callToAction?.actionType,
          callToActionUrl: post.callToAction?.url,
          eventTitle: post.event?.title,
          offerTitle: post.offer?.couponCode,
          publishedAt,
          updatedAtSource,
          rawPayload: post,
        },
        create: {
          businessId: business.id,
          googlePostId: post.name,
          languageCode: post.languageCode,
          summary: post.summary,
          topicType: post.topicType,
          state: post.state,
          searchUrl: post.searchUrl,
          callToActionType: post.callToAction?.actionType,
          callToActionUrl: post.callToAction?.url,
          eventTitle: post.event?.title,
          offerTitle: post.offer?.couponCode,
          publishedAt,
          updatedAtSource,
          rawPayload: post,
        },
      });
    }

    if (response.nextPageToken) {
      await this.jobsService.createJob(
        userId,
        'sync_posts_page',
        {
          businessId: business.id,
          mode: payload.mode,
          pageToken: response.nextPageToken,
        } satisfies PostPageJobPayload,
        {
          dedupeKey: `sync_posts_page:${business.id}:${payload.mode}:${response.nextPageToken}`,
        },
      );
      return;
    }

    await this.prisma.businessSyncState.update({
      where: { businessId: business.id },
      data: {
        postsSyncStatus: 'completed',
        lastPostSyncAt: newestSeenAt ?? new Date(),
        postsBackfilledAt:
          payload.mode === 'initial' ? new Date() : undefined,
      },
    });
    await this.refreshInitialSyncStatus(business.id);
  }

  async processMetricRange(userId: string, payload: MetricRangeJobPayload) {
    const business = await this.businessService.getBusinessById(userId, payload.businessId);
    const startDate = new Date(payload.startDate);
    const endDate = new Date(payload.endDate);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) {
      throw new BadRequestException('Invalid metric date range');
    }

    const response = await this.googleBusiness.fetchDailyMetrics(
      userId,
      business.googleLocationId,
      [...GBP_DAILY_METRICS],
      startDate,
      endDate,
    );

    for (const metricGroup of response.multiDailyMetricTimeSeries ?? []) {
      for (const metricSeries of metricGroup.dailyMetricTimeSeries ?? []) {
        const metricName = metricSeries.dailyMetric ?? 'UNKNOWN';
        const subEntityType =
          metricSeries.dailySubEntityType?.entityType ??
          metricSeries.dailySubEntityType?.dayOfWeek ??
          metricSeries.dailySubEntityType?.timeOfDay ??
          'ALL';

        for (const point of metricSeries.timeSeries?.datedValues ?? []) {
          if (!point.date?.year || !point.date?.month || !point.date?.day) {
            continue;
          }

          await this.prisma.businessMetricDaily.upsert({
            where: {
              businessId_metric_subEntityType_date: {
                businessId: business.id,
                metric: metricName,
                subEntityType,
                date: new Date(
                  Date.UTC(point.date.year, point.date.month - 1, point.date.day),
                ),
              },
            },
            update: {
              value: this.metricValueToNumber(point.value),
              metricLabel: metricName,
            },
            create: {
              businessId: business.id,
              metric: metricName,
              metricLabel: metricName,
              subEntityType,
              date: new Date(
                Date.UTC(point.date.year, point.date.month - 1, point.date.day),
              ),
              value: this.metricValueToNumber(point.value),
            },
          });
        }
      }
    }

    const hasPendingMetricJobs = await this.hasPendingJobsForBusiness(
      userId,
      business.id,
      ['sync_metrics_range'],
    );
    if (!hasPendingMetricJobs) {
      await this.prisma.businessSyncState.update({
        where: { businessId: business.id },
        data: {
          metricsSyncStatus: 'completed',
          lastMetricSyncAt: new Date(),
          metricsBackfilledAt:
            payload.mode === 'initial' ? new Date() : undefined,
        },
      });
      await this.refreshInitialSyncStatus(business.id);
    }
  }

  async markSyncFailed(businessId: string, target: 'reviews' | 'posts' | 'metrics' | 'initial', error: string) {
    const data: Record<string, SyncStatus | string> = {
      lastError: error.slice(0, 1000),
    };

    if (target === 'initial') {
      data.initialSyncStatus = 'failed';
    }
    if (target === 'reviews') {
      data.reviewsSyncStatus = 'failed';
    }
    if (target === 'posts') {
      data.postsSyncStatus = 'failed';
    }
    if (target === 'metrics') {
      data.metricsSyncStatus = 'failed';
    }

    await this.prisma.businessSyncState.update({
      where: { businessId },
      data,
    });
  }

  async recordRetryableSyncError(businessId: string, error: string) {
    await this.prisma.businessSyncState.update({
      where: { businessId },
      data: {
        lastError: error.slice(0, 1000),
      },
    });
  }

  private async enqueueReviewSync(
    userId: string,
    businessId: string,
    mode: SyncMode,
    stopAfterIso?: string,
  ) {
    await this.prisma.businessSyncState.update({
      where: { businessId },
      data: { reviewsSyncStatus: 'syncing' },
    });

    await this.jobsService.createJob(
      userId,
      'sync_reviews_page',
      {
        businessId,
        mode,
        stopAfterIso,
      } satisfies ReviewPageJobPayload,
      {
        dedupeKey: `sync_reviews_page:${businessId}:${mode}:first`,
      },
    );
  }

  private async enqueuePostSync(userId: string, businessId: string, mode: SyncMode) {
    await this.prisma.businessSyncState.update({
      where: { businessId },
      data: { postsSyncStatus: 'syncing' },
    });

    await this.jobsService.createJob(
      userId,
      'sync_posts_page',
      {
        businessId,
        mode,
      } satisfies PostPageJobPayload,
      {
        dedupeKey: `sync_posts_page:${businessId}:${mode}:first`,
      },
    );
  }

  private async enqueueMetricSync(
    userId: string,
    businessId: string,
    mode: SyncMode,
    months: number,
  ) {
    await this.prisma.businessSyncState.update({
      where: { businessId },
      data: { metricsSyncStatus: 'syncing' },
    });

    const endDate = this.endOfUtcDay(new Date());
    const startDate = this.startOfUtcDay(this.monthsAgo(months));

    let currentStart = startDate;
    while (currentStart <= endDate) {
      const currentEnd = this.endOfUtcDay(
        new Date(
          Math.min(
            endDate.getTime(),
            currentStart.getTime() + (METRIC_SYNC_CHUNK_DAYS - 1) * 24 * 60 * 60 * 1000,
          ),
        ),
      );

      await this.jobsService.createJob(
        userId,
        'sync_metrics_range',
        {
          businessId,
          mode,
          startDate: currentStart.toISOString(),
          endDate: currentEnd.toISOString(),
        } satisfies MetricRangeJobPayload,
        {
          dedupeKey: `sync_metrics_range:${businessId}:${mode}:${currentStart.toISOString()}:${currentEnd.toISOString()}`,
        },
      );

      currentStart = this.startOfUtcDay(new Date(currentEnd.getTime() + 24 * 60 * 60 * 1000));
    }
  }

  private async refreshInitialSyncStatus(businessId: string) {
    const state = await this.ensureSyncState(businessId);

    if (state.initialSyncStatus === 'completed') {
      return;
    }

    const statuses = [
      state.reviewsSyncStatus,
      state.postsSyncStatus,
      state.metricsSyncStatus,
    ];

    if (statuses.every((status) => status === 'completed')) {
      await this.prisma.businessSyncState.update({
        where: { businessId },
        data: {
          initialSyncStatus: 'completed',
          lastError: null,
        },
      });
      return;
    }

    if (statuses.some((status) => status === 'failed')) {
      await this.prisma.businessSyncState.update({
        where: { businessId },
        data: {
          initialSyncStatus: 'failed',
        },
      });
    }
  }

  private async refreshBusinessReviewStats(businessId: string) {
    const stats = await this.prisma.review.aggregate({
      where: { businessId },
      _avg: { rating: true },
      _count: true,
    });

    await this.prisma.business.update({
      where: { id: businessId },
      data: {
        averageRating: stats._avg.rating ?? 0,
        totalReviews: stats._count,
      },
    });
  }

  private async hasPendingJobsForBusiness(
    userId: string,
    businessId: string,
    types: string[],
  ) {
    const count = await this.prisma.job.count({
      where: {
        userId,
        type: { in: types as any[] },
        status: { in: ['pending', 'processing'] satisfies JobStatus[] },
        payload: {
          path: ['businessId'],
          equals: businessId,
        },
      },
    });

    return count > 1;
  }

  private normalizeMonths(months?: number) {
    if (!months) {
      return DEFAULT_METRIC_SYNC_MONTHS;
    }

    return Math.min(Math.max(Math.trunc(months), 1), 24);
  }

  private monthsAgo(months: number) {
    const date = new Date();
    date.setUTCMonth(date.getUTCMonth() - months);
    return this.startOfUtcDay(date);
  }

  private startOfUtcDay(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private endOfUtcDay(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
  }

  private starRatingToNumber(starRating: string): number {
    const map: Record<string, number> = {
      ONE: 1,
      TWO: 2,
      THREE: 3,
      FOUR: 4,
      FIVE: 5,
    };
    return map[starRating] ?? 0;
  }

  private metricValueToNumber(value?: string) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
