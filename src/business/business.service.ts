import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { GoogleBusinessService } from './google-business.service';
import { ConnectBusinessDto } from './dto/connect-business.dto';

@Injectable()
export class BusinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly googleBusiness: GoogleBusinessService,
  ) {}

  async listAccounts(userId: string) {
    return this.googleBusiness.listAccounts(userId);
  }

  async listLocations(userId: string, accountId: string) {
    return this.googleBusiness.listLocations(userId, accountId);
  }

  async connectBusiness(userId: string, dto: ConnectBusinessDto) {
    const { metricSyncMonths: _metricSyncMonths, ...businessData } = dto;

    return this.prisma.business.upsert({
      where: {
        userId_googleLocationId: {
          userId,
          googleLocationId: businessData.googleLocationId,
        },
      },
      update: {
        name: businessData.name,
        address: businessData.address,
        phone: businessData.phone,
        website: businessData.website,
        category: businessData.category,
        googleAccountId: businessData.googleAccountId,
      },
      create: {
        userId,
        googleAccountId: businessData.googleAccountId,
        googleLocationId: businessData.googleLocationId,
        name: businessData.name,
        address: businessData.address,
        phone: businessData.phone,
        website: businessData.website,
        category: businessData.category,
      },
    });
  }

  async getUserBusinesses(userId: string) {
    return this.prisma.business.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBusinessById(userId: string, businessId: string) {
    const business = await this.prisma.business.findFirst({
      where: { id: businessId, userId },
    });
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  async deleteBusiness(userId: string, businessId: string) {
    const business = await this.getBusinessById(userId, businessId);
    return this.prisma.business.delete({ where: { id: business.id } });
  }
}
