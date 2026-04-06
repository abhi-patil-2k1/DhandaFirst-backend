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
    return this.prisma.business.upsert({
      where: {
        userId_googleLocationId: {
          userId,
          googleLocationId: dto.googleLocationId,
        },
      },
      update: {
        name: dto.name,
        address: dto.address,
        phone: dto.phone,
        website: dto.website,
        category: dto.category,
        googleAccountId: dto.googleAccountId,
      },
      create: {
        userId,
        googleAccountId: dto.googleAccountId,
        googleLocationId: dto.googleLocationId,
        name: dto.name,
        address: dto.address,
        phone: dto.phone,
        website: dto.website,
        category: dto.category,
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
