import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import type { Credentials } from 'google-auth-library';
import { PrismaService } from '@/common/prisma/prisma.service';
import { decrypt, encrypt } from '@/common/utils/encryption';

interface GoogleListReviewsResponse {
  reviews?: Array<Record<string, any>>;
  averageRating?: number;
  totalReviewCount?: number;
  nextPageToken?: string;
}

interface GoogleListPostsResponse {
  localPosts?: Array<Record<string, any>>;
  nextPageToken?: string;
}

interface GooglePerformanceResponse {
  multiDailyMetricTimeSeries?: Array<{
    dailyMetricTimeSeries?: Array<{
      dailyMetric?: string;
      dailySubEntityType?: { dayOfWeek?: string; timeOfDay?: string; entityType?: string };
      timeSeries?: {
        datedValues?: Array<{
          date?: { year?: number; month?: number; day?: number };
          value?: string;
        }>;
      };
    }>;
  }>;
}

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

    oauth2Client.on('tokens', async (tokens) => {
      await this.persistGoogleTokens(userId, tokens);
    });

    return oauth2Client;
  }

  private async persistGoogleTokens(userId: string, tokens: Credentials) {
    if (!tokens.access_token && !tokens.refresh_token && !tokens.expiry_date) {
      return;
    }

    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY')!;
    const data: Record<string, unknown> = {};

    if (tokens.access_token) {
      data.googleAccessToken = encrypt(tokens.access_token, encryptionKey);
    }

    if (tokens.refresh_token) {
      data.googleRefreshToken = encrypt(tokens.refresh_token, encryptionKey);
    }

    if (tokens.expiry_date) {
      data.googleTokenExpiry = new Date(tokens.expiry_date);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data,
    });
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

  async listReviewsPage(
    userId: string,
    locationName: string,
    pageToken?: string,
    pageSize = 50,
    orderBy = 'updateTime desc',
  ) {
    const auth = await this.getOAuth2Client(userId);

    try {
      const response = await auth.request<GoogleListReviewsResponse>({
        url: `https://mybusiness.googleapis.com/v4/${locationName}/reviews`,
        method: 'GET',
        params: {
          pageSize,
          pageToken,
          orderBy,
        },
      });
      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch reviews', error);
      throw error;
    }
  }

  async listLocalPostsPage(
    userId: string,
    locationName: string,
    pageToken?: string,
    pageSize = 100,
  ) {
    const auth = await this.getOAuth2Client(userId);

    try {
      const response = await auth.request<GoogleListPostsResponse>({
        url: `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
        method: 'GET',
        params: {
          pageSize,
          pageToken,
        },
      });
      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch local posts', error);
      throw error;
    }
  }

  async fetchDailyMetrics(
    userId: string,
    googleLocationId: string,
    dailyMetrics: string[],
    startDate: Date,
    endDate: Date,
  ) {
    const auth = await this.getOAuth2Client(userId);

    try {
      const query = new URLSearchParams();
      for (const metric of dailyMetrics) {
        query.append('dailyMetrics', metric);
      }
      query.append('dailyRange.start_date.year', String(startDate.getUTCFullYear()));
      query.append('dailyRange.start_date.month', String(startDate.getUTCMonth() + 1));
      query.append('dailyRange.start_date.day', String(startDate.getUTCDate()));
      query.append('dailyRange.end_date.year', String(endDate.getUTCFullYear()));
      query.append('dailyRange.end_date.month', String(endDate.getUTCMonth() + 1));
      query.append('dailyRange.end_date.day', String(endDate.getUTCDate()));

      const response = await auth.request<GooglePerformanceResponse>({
        url: `https://businessprofileperformance.googleapis.com/v1/locations/${googleLocationId}:fetchMultiDailyMetricsTimeSeries?${query.toString()}`,
        method: 'GET',
      });
      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch performance metrics', error);
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
