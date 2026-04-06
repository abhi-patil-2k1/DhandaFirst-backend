import { Module } from '@nestjs/common';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { AiReplyService } from './ai-reply.service';
import { BusinessModule } from '@/business/business.module';

@Module({
  imports: [BusinessModule],
  controllers: [ReviewController],
  providers: [ReviewService, AiReplyService],
  exports: [ReviewService, AiReplyService],
})
export class ReviewModule {}
