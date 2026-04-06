import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/common/prisma/prisma.service';
import { encrypt } from '@/common/utils/encryption';

interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

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
        googleTokenExpiry: new Date(Date.now() + 3600 * 1000),
      },
      create: {
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        googleAccessToken: encrypt(profile.accessToken, encryptionKey),
        googleRefreshToken: profile.refreshToken
          ? encrypt(profile.refreshToken, encryptionKey)
          : undefined,
        googleTokenExpiry: new Date(Date.now() + 3600 * 1000),
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
}
