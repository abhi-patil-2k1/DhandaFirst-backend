import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsWorker } from './jobs.worker';
import { JobsController } from './jobs.controller';
import { ReviewModule } from '@/review/review.module';
import { BusinessModule } from '@/business/business.module';

@Module({
  imports: [ReviewModule, BusinessModule],
  controllers: [JobsController],
  providers: [JobsService, JobsWorker],
  exports: [JobsService],
})
export class JobsModule {}
