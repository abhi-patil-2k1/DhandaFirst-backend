import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '@/common/decorators/current-user.decorator';
import { BusinessService } from './business.service';
import { ConnectBusinessDto } from './dto/connect-business.dto';
import { BusinessSyncService } from './business-sync.service';

@ApiTags('businesses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('businesses')
export class BusinessController {
  constructor(
    private readonly businessService: BusinessService,
    private readonly businessSyncService: BusinessSyncService,
  ) {}

  @Get('google/accounts')
  async listGoogleAccounts(@CurrentUser() user: JwtPayload) {
    const accounts = await this.businessService.listAccounts(user.sub);
    return { success: true, data: accounts };
  }

  @Get('google/locations')
  async listGoogleLocations(
    @CurrentUser() user: JwtPayload,
    @Query('accountId') accountId: string,
  ) {
    const locations = await this.businessService.listLocations(user.sub, accountId);
    return { success: true, data: locations };
  }

  @Post('connect')
  async connectBusiness(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConnectBusinessDto,
  ) {
    const business = await this.businessService.connectBusiness(user.sub, dto);
    const syncJob = await this.businessSyncService.startInitialSync(user.sub, business.id, {
      months: dto.metricSyncMonths,
    });
    return { success: true, data: { business, syncJob } };
  }

  @Get()
  async listBusinesses(@CurrentUser() user: JwtPayload) {
    const businesses = await this.businessService.getUserBusinesses(user.sub);
    return { success: true, data: businesses };
  }

  @Get(':id')
  async getBusiness(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const business = await this.businessService.getBusinessById(user.sub, id);
    return { success: true, data: business };
  }

  @Get(':id/sync')
  async getSyncStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const status = await this.businessSyncService.getSyncStatus(user.sub, id);
    return { success: true, data: status };
  }

  @Post(':id/sync')
  async triggerIncrementalSync(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const job = await this.businessSyncService.startIncrementalSync(user.sub, id);
    return { success: true, data: job };
  }

  @Get(':id/posts')
  async listPosts(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('months') months?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const posts = await this.businessSyncService.listPosts(user.sub, id, {
      months: months ? parseInt(months, 10) : undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, ...posts };
  }

  @Delete(':id')
  async deleteBusiness(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    await this.businessService.deleteBusiness(user.sub, id);
    return { success: true, message: 'Business disconnected' };
  }
}
