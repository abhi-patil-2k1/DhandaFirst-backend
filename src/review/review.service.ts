import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { BusinessService } from '@/business/business.service';
import { GoogleBusinessService } from '@/business/google-business.service';
import { BusinessSyncService } from '@/business/business-sync.service';

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessService: BusinessService,
    private readonly googleBusiness: GoogleBusinessService,
    private readonly businessSyncService: BusinessSyncService,
  ) {}

  async getReviews(
    userId: string,
    businessId: string,
    filters: {
      status?: 'all' | 'replied' | 'unreplied';
      rating?: number;
      months?: number;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    },
  ) {
    // Verify ownership
    await this.businessService.getBusinessById(userId, businessId);

    const {
      status = 'all',
      rating,
      months,
      page = 1,
      limit = 20,
      sortBy = 'reviewedAt',
      sortOrder = 'desc',
    } = filters;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { businessId };
    if (status === 'replied') where.replyComment = { not: null };
    if (status === 'unreplied') where.replyComment = null;
    if (rating) where.rating = rating;
    if (months) {
      const since = new Date();
      since.setUTCMonth(since.getUTCMonth() - Math.min(Math.max(Math.trunc(months), 1), 24));
      since.setUTCHours(0, 0, 0, 0);
      where.reviewedAt = { gte: since };
    }

    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.review.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getReviewById(userId: string, reviewId: string) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: { business: true },
    });
    if (!review || review.business.userId !== userId) {
      throw new NotFoundException('Review not found');
    }
    return review;
  }

  async syncReviews(userId: string, businessId: string) {
    const job = await this.businessSyncService.startIncrementalSync(userId, businessId);
    return {
      jobId: job.id,
      status: job.status,
      message: 'Review sync queued in background',
    };
  }

  async replyToReview(
    userId: string,
    reviewId: string,
    comment: string,
  ) {
    const review = await this.getReviewById(userId, reviewId);
    const business = review.business;

    const reviewName = `${business.googleAccountId}/locations/${business.googleLocationId}/reviews/${review.googleReviewId}`;
    await this.googleBusiness.replyToReview(userId, reviewName, comment);

    return this.prisma.review.update({
      where: { id: reviewId },
      data: {
        replyComment: comment,
        repliedAt: new Date(),
      },
    });
  }

  async saveAiSuggestedReply(reviewId: string, reply: string) {
    return this.prisma.review.update({
      where: { id: reviewId },
      data: { aiSuggestedReply: reply },
    });
  }
}
