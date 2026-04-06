import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReplyReviewDto {
  @ApiProperty({ description: 'Reply text for the review' })
  @IsString()
  @MinLength(1)
  comment: string;
}
