import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(userId: string, businessId?: string) {
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

    return {
      totalReviews,
      averageRating: Math.round(averageRating * 10) / 10,
      unrepliedCount,
      reviewsTrend,
      ratingTrend,
      businessCount: businesses.length,
    };
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
}
