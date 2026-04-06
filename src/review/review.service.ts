import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { BusinessService } from '@/business/business.service';
import { GoogleBusinessService } from '@/business/google-business.service';

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessService: BusinessService,
    private readonly googleBusiness: GoogleBusinessService,
  ) {}

  async getReviews(
    userId: string,
    businessId: string,
    filters: {
      status?: 'all' | 'replied' | 'unreplied';
      rating?: number;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    },
  ) {
    // Verify ownership
    await this.businessService.getBusinessById(userId, businessId);

    const { status = 'all', rating, page = 1, limit = 20, sortBy = 'reviewedAt', sortOrder = 'desc' } = filters;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { businessId };
    if (status === 'replied') where.replyComment = { not: null };
    if (status === 'unreplied') where.replyComment = null;
    if (rating) where.rating = rating;

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
    const business = await this.businessService.getBusinessById(userId, businessId);
    const locationName = `${business.googleAccountId}/locations/${business.googleLocationId}`;

    const googleReviews = await this.googleBusiness.getReviews(userId, locationName);

    let synced = 0;
    for (const gr of googleReviews) {
      await this.prisma.review.upsert({
        where: { googleReviewId: gr.reviewId ?? gr.name },
        update: {
          rating: gr.starRating ? this.starRatingToNumber(gr.starRating) : 0,
          comment: gr.comment,
          replyComment: gr.reviewReply?.comment,
          repliedAt: gr.reviewReply?.updateTime
            ? new Date(gr.reviewReply.updateTime)
            : null,
        },
        create: {
          businessId,
          googleReviewId: gr.reviewId ?? gr.name,
          authorName: gr.reviewer?.displayName ?? 'Anonymous',
          authorPhotoUrl: gr.reviewer?.profilePhotoUrl,
          rating: gr.starRating ? this.starRatingToNumber(gr.starRating) : 0,
          comment: gr.comment,
          replyComment: gr.reviewReply?.comment,
          repliedAt: gr.reviewReply?.updateTime
            ? new Date(gr.reviewReply.updateTime)
            : null,
          reviewedAt: new Date(gr.createTime ?? gr.updateTime ?? Date.now()),
        },
      });
      synced++;
    }

    // Update business stats
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

    return { synced };
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

  private starRatingToNumber(starRating: string): number {
    const map: Record<string, number> = {
      ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
    };
    return map[starRating] ?? 0;
  }
}
