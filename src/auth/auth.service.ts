import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/common/prisma/prisma.service';
import { encrypt } from '@/common/utils/encryption';
import { google } from 'googleapis';

interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  accessToken: string;
  refreshToken: string;
  scopes?: string[];
  tokenExpiryDate?: Date;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  getGoogleAuthUrl() {
    const oauth2Client = this.getOAuth2Client();

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: [
        'openid',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/business.manage',
      ],
      response_type: 'code',
    });
  }

  async exchangeCodeForGoogleProfile(code: string): Promise<GoogleProfile> {
    const oauth2Client = this.getOAuth2Client();
    const tokenResponse = await oauth2Client.getToken(code);
    const tokens = tokenResponse.tokens;

    oauth2Client.setCredentials(tokens);

    this.logger.log(
      JSON.stringify({
        event: 'google_token_exchange',
        hasAccessToken: Boolean(tokens.access_token),
        hasRefreshToken: Boolean(tokens.refresh_token),
        expiryDate: tokens.expiry_date ?? null,
        scope: tokens.scope ?? null,
      }),
    );

    const oauth2 = google.oauth2({
      version: 'v2',
      auth: oauth2Client,
    });

    const userInfoResponse = await oauth2.userinfo.get();
    const userInfo = userInfoResponse.data;

    if (!userInfo.id || !userInfo.email || !tokens.access_token) {
      throw new Error('Google OAuth response missing required profile or token fields');
    }

    return {
      googleId: userInfo.id,
      email: userInfo.email,
      name: userInfo.name ?? userInfo.email,
      avatarUrl: userInfo.picture ?? undefined,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? '',
      scopes: tokens.scope?.split(' ') ?? [],
      tokenExpiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    };
  }

  async handleGoogleLogin(profile: GoogleProfile) {
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY')!;

    this.logger.log(
      JSON.stringify({
        event: 'handle_google_login',
        email: profile.email,
        googleId: profile.googleId,
        hasAccessToken: Boolean(profile.accessToken),
        hasRefreshToken: Boolean(profile.refreshToken),
      }),
    );

    const user = await this.prisma.user.upsert({
      where: { email: profile.email },
      update: {
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        googleAccessToken: encrypt(profile.accessToken, encryptionKey),
        googleRefreshToken: profile.refreshToken
          ? encrypt(profile.refreshToken, encryptionKey)
          : undefined,
        googleTokenExpiry: profile.tokenExpiryDate ?? new Date(Date.now() + 3600 * 1000),
        googleScopes: profile.scopes?.join(' ') ?? undefined,
      },
      create: {
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        googleAccessToken: encrypt(profile.accessToken, encryptionKey),
        googleRefreshToken: profile.refreshToken
          ? encrypt(profile.refreshToken, encryptionKey)
          : undefined,
        googleTokenExpiry: profile.tokenExpiryDate ?? new Date(Date.now() + 3600 * 1000),
        googleScopes: profile.scopes?.join(' ') ?? undefined,
        settings: { create: {} },
      },
    });

    this.logger.log(`User logged in: ${user.email}`);

    const tokens = this.generateTokens(user.id, user.email, user.role);
    return { user, ...tokens };
  }

  generateTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };
    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: this.jwtService.sign(payload, { expiresIn: '30d' }),
    };
  }

  async getUserById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  private getOAuth2Client() {
    return new google.auth.OAuth2(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
      this.configService.get<string>('GOOGLE_CALLBACK_URL'),
    );
  }
}
