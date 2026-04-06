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

@ApiTags('businesses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('businesses')
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

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
    return { success: true, data: business };
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

  @Delete(':id')
  async deleteBusiness(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    await this.businessService.deleteBusiness(user.sub, id);
    return { success: true, message: 'Business disconnected' };
  }
}
