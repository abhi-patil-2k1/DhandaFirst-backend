import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { PrismaService } from '@/common/prisma/prisma.service';
import { decrypt } from '@/common/utils/encryption';

@Injectable()
export class GoogleBusinessService {
  private readonly logger = new Logger(GoogleBusinessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private async getOAuth2Client(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY')!;
    const oauth2Client = new google.auth.OAuth2(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
    );

    oauth2Client.setCredentials({
      access_token: user.googleAccessToken
        ? decrypt(user.googleAccessToken, encryptionKey)
        : undefined,
      refresh_token: user.googleRefreshToken
        ? decrypt(user.googleRefreshToken, encryptionKey)
        : undefined,
    });

    return oauth2Client;
  }

  async listAccounts(userId: string) {
    const auth = await this.getOAuth2Client(userId);
    const mybusiness = google.mybusinessaccountmanagement({ version: 'v1', auth });

    try {
      const response = await mybusiness.accounts.list();
      return response.data.accounts ?? [];
    } catch (error) {
      this.logger.error('Failed to list GBP accounts', error);
      throw error;
    }
  }

  async listLocations(userId: string, accountId: string) {
    const auth = await this.getOAuth2Client(userId);
    const mybusiness = google.mybusinessbusinessinformation({
      version: 'v1',
      auth,
    });

    try {
      const response = await mybusiness.accounts.locations.list({
        parent: accountId,
        readMask: 'name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours',
      });
      return response.data.locations ?? [];
    } catch (error) {
      this.logger.error('Failed to list locations', error);
      throw error;
    }
  }

  async getReviews(userId: string, locationName: string) {
    const auth = await this.getOAuth2Client(userId);
    const mybusiness = google.mybusinessaccountmanagement({ version: 'v1', auth });

    try {
      // Use the My Business API for reviews
      const response = await (google as any)
        .mybusiness({ version: 'v4', auth })
        .accounts.locations.reviews.list({
          parent: locationName,
          pageSize: 50,
        });
      return response.data.reviews ?? [];
    } catch (error) {
      this.logger.error('Failed to fetch reviews', error);
      throw error;
    }
  }

  async replyToReview(
    userId: string,
    reviewName: string,
    comment: string,
  ) {
    const auth = await this.getOAuth2Client(userId);

    try {
      const response = await (google as any)
        .mybusiness({ version: 'v4', auth })
        .accounts.locations.reviews.updateReply({
          name: `${reviewName}/reply`,
          requestBody: { comment },
        });
      return response.data;
    } catch (error) {
      this.logger.error('Failed to reply to review', error);
      throw error;
    }
  }
}
