import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/common/prisma/prisma.service';
import { encrypt } from '@/common/utils/encryption';
import { google } from 'googleapis';
import { randomBytes } from 'crypto';

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

export interface AuthCookieOptions {
  httpOnly: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  secure: boolean;
  path: string;
  maxAge: number;
  domain?: string;
}

interface JwtTokenPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  getGoogleAuthUrl(state: string) {
    const oauth2Client = this.getOAuth2Client();

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      state,
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
      accessToken: this.jwtService.sign(payload, {
        expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRATION', '15m'),
      }),
      refreshToken: this.jwtService.sign(payload, {
        expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION', '30d'),
      }),
    };
  }

  generateOAuthState() {
    return randomBytes(32).toString('hex');
  }

  getOAuthStateCookieOptions(): AuthCookieOptions {
    return {
      httpOnly: true,
      sameSite: this.getCookieSameSite(),
      secure: this.shouldUseSecureCookies(),
      path: '/api/auth',
      maxAge: 10 * 60 * 1000,
      domain: this.getCookieDomain(),
    };
  }

  getSessionCookieOptions(kind: 'access' | 'refresh'): AuthCookieOptions {
    const isAccess = kind === 'access';

    return {
      httpOnly: true,
      sameSite: this.getCookieSameSite(),
      secure: this.shouldUseSecureCookies(),
      path: '/',
      maxAge: isAccess ? 15 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000,
      domain: this.getCookieDomain(),
    };
  }

  shouldUseCookieTransport() {
    return this.configService.get<string>('AUTH_TOKEN_TRANSPORT', 'query') === 'cookie';
  }

  buildFrontendAuthRedirect(params: {
    accessToken?: string;
    refreshToken?: string;
    error?: string;
  }) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL')!;
    const callbackPath = this.configService.get<string>(
      'FRONTEND_AUTH_CALLBACK_PATH',
      '/auth/callback',
    );
    const redirectUrl = new URL(callbackPath, frontendUrl);

    if (params.error) {
      redirectUrl.searchParams.set('error', params.error);
      return redirectUrl.toString();
    }

    if (!this.shouldUseCookieTransport()) {
      if (params.accessToken) {
        redirectUrl.searchParams.set('token', params.accessToken);
      }

      if (params.refreshToken) {
        redirectUrl.searchParams.set('refresh', params.refreshToken);
      }
    }

    return redirectUrl.toString();
  }

  async refreshSession(refreshToken: string) {
    let payload: JwtTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtTokenPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.generateTokens(user.id, user.email, user.role);
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

  private shouldUseSecureCookies() {
    return this.getCookieSameSite() === 'none'
      || this.configService.get<string>('NODE_ENV') === 'production';
  }

  private getCookieSameSite(): AuthCookieOptions['sameSite'] {
    return this.configService.get<'lax' | 'strict' | 'none'>(
      'AUTH_COOKIE_SAMESITE',
      'lax',
    );
  }

  private getCookieDomain() {
    return this.configService.get<string>('AUTH_COOKIE_DOMAIN') || undefined;
  }
}
