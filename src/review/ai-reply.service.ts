import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class AiReplyService {
  private readonly logger = new Logger(AiReplyService.name);
  private openai: OpenAI | null = null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    }
  }

  async generateReply(
    businessName: string,
    reviewerName: string,
    rating: number,
    reviewText: string,
  ): Promise<string> {
    if (!this.openai) {
      return this.generateFallbackReply(reviewerName, rating);
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a professional business owner replying to Google reviews for "${businessName}".
Write a warm, professional, and concise reply (2-3 sentences max).
- For positive reviews (4-5 stars): Thank the reviewer and mention something specific from their review.
- For neutral reviews (3 stars): Thank them, acknowledge their feedback, and express commitment to improvement.
- For negative reviews (1-2 stars): Apologize sincerely, acknowledge their concern, and invite them to contact you directly.
Never be defensive. Always be genuine and helpful.`,
          },
          {
            role: 'user',
            content: `Reviewer: ${reviewerName}\nRating: ${rating}/5\nReview: ${reviewText || '(No text provided)'}`,
          },
        ],
        max_tokens: 200,
        temperature: 0.7,
      });

      return response.choices[0]?.message?.content ?? this.generateFallbackReply(reviewerName, rating);
    } catch (error) {
      this.logger.error('OpenAI API error', error);
      return this.generateFallbackReply(reviewerName, rating);
    }
  }

  private generateFallbackReply(reviewerName: string, rating: number): string {
    if (rating >= 4) {
      return `Thank you so much for your wonderful review, ${reviewerName}! We truly appreciate your support and look forward to serving you again.`;
    }
    if (rating === 3) {
      return `Thank you for your feedback, ${reviewerName}. We appreciate you taking the time to share your experience and are always working to improve.`;
    }
    return `Thank you for bringing this to our attention, ${reviewerName}. We sincerely apologize for your experience and would love the opportunity to make it right. Please reach out to us directly.`;
  }
}
