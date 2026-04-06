import { Module } from '@nestjs/common';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';
import { GoogleBusinessService } from './google-business.service';

@Module({
  controllers: [BusinessController],
  providers: [BusinessService, GoogleBusinessService],
  exports: [BusinessService, GoogleBusinessService],
})
export class BusinessModule {}
