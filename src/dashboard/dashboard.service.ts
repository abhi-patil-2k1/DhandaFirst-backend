import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { DEFAULT_METRIC_SYNC_MONTHS } from '@/business/business-sync.constants';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(userId: string, businessId?: string, months = DEFAULT_METRIC_SYNC_MONTHS) {
    const businessWhere = businessId
      ? { id: businessId, userId }
      : { userId };

    const businesses = await this.prisma.business.findMany({
      where: businessWhere,
      select: { id: true, averageRating: true, totalReviews: true },
    });

    const businessIds = businesses.map((b) => b.id);

    const totalReviews = businesses.reduce((sum, b) => sum + b.totalReviews, 0);
    const averageRating =
      businesses.length > 0
        ? businesses.reduce((sum, b) => sum + b.averageRating, 0) / businesses.length
        : 0;

    const unrepliedCount = await this.prisma.review.count({
      where: {
        businessId: { in: businessIds },
        replyComment: null,
      },
    });

    // Review trends (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentReviews = await this.prisma.review.findMany({
      where: {
        businessId: { in: businessIds },
        reviewedAt: { gte: thirtyDaysAgo },
      },
      select: { reviewedAt: true, rating: true },
      orderBy: { reviewedAt: 'asc' },
    });

    const reviewsTrend = this.aggregateByDate(
      recentReviews.map((r) => ({ date: r.reviewedAt, value: 1 })),
      'sum',
    );

    const ratingTrend = this.aggregateByDate(
      recentReviews.map((r) => ({ date: r.reviewedAt, value: r.rating })),
      'avg',
    );

    const metricSince = new Date();
    metricSince.setUTCMonth(metricSince.getUTCMonth() - months);
    metricSince.setUTCHours(0, 0, 0, 0);

    const performanceMetrics = await this.prisma.businessMetricDaily.findMany({
      where: {
        businessId: { in: businessIds },
        date: { gte: metricSince },
      },
      orderBy: [{ metric: 'asc' }, { date: 'asc' }],
    });

    return {
      totalReviews,
      averageRating: Math.round(averageRating * 10) / 10,
      unrepliedCount,
      reviewsTrend,
      ratingTrend,
      businessCount: businesses.length,
      performance: this.aggregatePerformance(performanceMetrics),
    };
  }

  async getPerformanceMetrics(userId: string, businessId: string, months = DEFAULT_METRIC_SYNC_MONTHS) {
    const business = await this.prisma.business.findFirst({
      where: { id: businessId, userId },
      select: { id: true },
    });

    if (!business) {
      throw new NotFoundException('Business not found');
    }

    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - months);
    since.setUTCHours(0, 0, 0, 0);

    const metrics = await this.prisma.businessMetricDaily.findMany({
      where: {
        businessId,
        date: { gte: since },
      },
      orderBy: [{ metric: 'asc' }, { date: 'asc' }],
    });

    return this.aggregatePerformance(metrics);
  }

  private aggregateByDate(
    items: { date: Date; value: number }[],
    mode: 'sum' | 'avg',
  ) {
    const map = new Map<string, { total: number; count: number }>();

    for (const item of items) {
      const key = item.date.toISOString().split('T')[0];
      const existing = map.get(key) || { total: 0, count: 0 };
      existing.total += item.value;
      existing.count += 1;
      map.set(key, existing);
    }

    return Array.from(map.entries()).map(([date, { total, count }]) => ({
      date,
      value: mode === 'avg' ? Math.round((total / count) * 10) / 10 : total,
    }));
  }

  private aggregatePerformance(
    metrics: Array<{ metric: string; date: Date; value: number; subEntityType: string }>,
  ) {
    const byMetric = new Map<
      string,
      {
        total: number;
        series: { date: string; value: number }[];
      }
    >();

    for (const metric of metrics) {
      const key = metric.subEntityType && metric.subEntityType !== 'ALL'
        ? `${metric.metric}:${metric.subEntityType}`
        : metric.metric;
      const entry = byMetric.get(key) ?? { total: 0, series: [] };
      entry.total += metric.value;
      entry.series.push({
        date: metric.date.toISOString().split('T')[0],
        value: metric.value,
      });
      byMetric.set(key, entry);
    }

    return Array.from(byMetric.entries()).map(([metric, value]) => ({
      metric,
      total: value.total,
      series: value.series,
    }));
  }
}
