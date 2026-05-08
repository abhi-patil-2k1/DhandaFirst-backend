import { Module, forwardRef } from '@nestjs/common';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';
import { GoogleBusinessService } from './google-business.service';
import { BusinessSyncService } from './business-sync.service';
import { JobsModule } from '@/jobs/jobs.module';

@Module({
  imports: [forwardRef(() => JobsModule)],
  controllers: [BusinessController],
  providers: [BusinessService, GoogleBusinessService, BusinessSyncService],
  exports: [BusinessService, GoogleBusinessService, BusinessSyncService],
})
export class BusinessModule {}
