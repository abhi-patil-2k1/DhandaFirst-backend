import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';

export interface Insight {
  id: string;
  type: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  actionUrl?: string;
}

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async getInsights(userId: string): Promise<Insight[]> {
    const insights: Insight[] = [];

    const businesses = await this.prisma.business.findMany({
      where: { userId },
      select: { id: true, name: true },
    });

    const businessIds = businesses.map((b) => b.id);

    // Unreplied reviews insight
    const unrepliedCount = await this.prisma.review.count({
      where: {
        businessId: { in: businessIds },
        replyComment: null,
      },
    });

    if (unrepliedCount > 0) {
      insights.push({
        id: 'unreplied-reviews',
        type: 'unreplied_reviews',
        title: `${unrepliedCount} reviews need replies`,
        description: `You have ${unrepliedCount} unanswered review${unrepliedCount > 1 ? 's' : ''}. Replying to reviews improves your visibility and customer trust.`,
        priority: unrepliedCount > 10 ? 'high' : unrepliedCount > 3 ? 'medium' : 'low',
        actionUrl: '/reviews?status=unreplied',
      });
    }

    // Rating drop detection
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentAvg = await this.prisma.review.aggregate({
      where: {
        businessId: { in: businessIds },
        reviewedAt: { gte: sevenDaysAgo },
      },
      _avg: { rating: true },
    });

    const olderAvg = await this.prisma.review.aggregate({
      where: {
        businessId: { in: businessIds },
        reviewedAt: { gte: thirtyDaysAgo, lt: sevenDaysAgo },
      },
      _avg: { rating: true },
    });

    if (
      recentAvg._avg.rating &&
      olderAvg._avg.rating &&
      recentAvg._avg.rating < olderAvg._avg.rating - 0.5
    ) {
      insights.push({
        id: 'rating-drop',
        type: 'rating_drop',
        title: 'Rating trending down',
        description: `Your average rating dropped from ${olderAvg._avg.rating.toFixed(1)} to ${recentAvg._avg.rating.toFixed(1)} in the last 7 days. Review recent feedback to identify issues.`,
        priority: 'high',
        actionUrl: '/reviews?sortBy=reviewedAt&sortOrder=desc',
      });
    }

    // Review volume spike
    const recentCount = await this.prisma.review.count({
      where: {
        businessId: { in: businessIds },
        reviewedAt: { gte: sevenDaysAgo },
      },
    });

    const olderCount = await this.prisma.review.count({
      where: {
        businessId: { in: businessIds },
        reviewedAt: { gte: thirtyDaysAgo, lt: sevenDaysAgo },
      },
    });

    const weeklyAverage = olderCount / 3.3; // ~23 days / 7
    if (recentCount > weeklyAverage * 2 && recentCount > 3) {
      insights.push({
        id: 'review-spike',
        type: 'review_spike',
        title: 'Review activity spike detected',
        description: `You received ${recentCount} reviews this week, which is ${Math.round((recentCount / weeklyAverage - 1) * 100)}% above average. Great visibility!`,
        priority: 'medium',
      });
    }

    // General suggestion
    if (businesses.length > 0 && unrepliedCount === 0) {
      insights.push({
        id: 'keep-it-up',
        type: 'suggestion',
        title: 'All reviews replied!',
        description: 'Great job staying on top of your reviews. Consistent engagement boosts your local ranking.',
        priority: 'low',
      });
    }

    return insights;
  }
}
