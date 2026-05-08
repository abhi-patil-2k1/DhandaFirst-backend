import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConnectBusinessDto {
  @ApiProperty()
  @IsString()
  googleAccountId: string;

  @ApiProperty()
  @IsString()
  googleLocationId: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 24, default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  metricSyncMonths?: number;
}
