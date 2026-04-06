import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '@/common/decorators/current-user.decorator';
import { ReviewService } from './review.service';
import { AiReplyService } from './ai-reply.service';
import { ReplyReviewDto } from './dto/reply-review.dto';

@ApiTags('reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reviews')
export class ReviewController {
  constructor(
    private readonly reviewService: ReviewService,
    private readonly aiReplyService: AiReplyService,
  ) {}

  @Get('business/:businessId')
  @ApiQuery({ name: 'status', required: false, enum: ['all', 'replied', 'unreplied'] })
  @ApiQuery({ name: 'rating', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getReviews(
    @CurrentUser() user: JwtPayload,
    @Param('businessId') businessId: string,
    @Query('status') status?: 'all' | 'replied' | 'unreplied',
    @Query('rating') rating?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
    const result = await this.reviewService.getReviews(user.sub, businessId, {
      status,
      rating: rating ? parseInt(rating) : undefined,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      sortBy,
      sortOrder,
    });
    return { success: true, ...result };
  }

  @Get(':id')
  async getReview(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const review = await this.reviewService.getReviewById(user.sub, id);
    return { success: true, data: review };
  }

  @Post('business/:businessId/sync')
  async syncReviews(
    @CurrentUser() user: JwtPayload,
    @Param('businessId') businessId: string,
  ) {
    const result = await this.reviewService.syncReviews(user.sub, businessId);
    return { success: true, data: result };
  }

  @Post(':id/reply')
  async replyToReview(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ReplyReviewDto,
  ) {
    const review = await this.reviewService.replyToReview(user.sub, id, dto.comment);
    return { success: true, data: review };
  }

  @Post(':id/ai-reply')
  async generateAiReply(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const review = await this.reviewService.getReviewById(user.sub, id);
    const reply = await this.aiReplyService.generateReply(
      review.business.name,
      review.authorName,
      review.rating,
      review.comment ?? '',
    );

    await this.reviewService.saveAiSuggestedReply(id, reply);
    return { success: true, data: { suggestedReply: reply } };
  }
}
