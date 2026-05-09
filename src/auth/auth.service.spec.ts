import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  } as any;

  const jwtService = {
    sign: jest.fn(),
    verifyAsync: jest.fn(),
  } as unknown as jest.Mocked<JwtService>;

  const configMap: Record<string, string> = {
    FRONTEND_URL: 'http://localhost:3000',
    FRONTEND_AUTH_CALLBACK_PATH: '/auth/callback',
    AUTH_TOKEN_TRANSPORT: 'query',
    AUTH_COOKIE_SAMESITE: 'lax',
    NODE_ENV: 'development',
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_CALLBACK_URL: 'http://localhost:4000/api/auth/google/callback',
    JWT_SECRET: 'super-secret-value',
    JWT_ACCESS_EXPIRATION: '15m',
    JWT_REFRESH_EXPIRATION: '30d',
    ENCRYPTION_KEY: '12345678901234567890123456789012',
  };

  const configService = {
    get: jest.fn((key: string, defaultValue?: string) => configMap[key] ?? defaultValue),
  } as unknown as jest.Mocked<ConfigService>;

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(prisma, jwtService, configService);
  });

  it('builds frontend redirect with tokens in query mode', () => {
    const redirect = service.buildFrontendAuthRedirect({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });

    expect(redirect).toBe(
      'http://localhost:3000/auth/callback?token=access-token&refresh=refresh-token',
    );
  });

  it('omits tokens from redirect in cookie mode', () => {
    configMap.AUTH_TOKEN_TRANSPORT = 'cookie';

    const redirect = service.buildFrontendAuthRedirect({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });

    expect(redirect).toBe('http://localhost:3000/auth/callback');
  });

  it('refreshes session for a valid refresh token', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
      role: 'member',
    } as never);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      role: 'member',
    });
    jwtService.sign
      .mockReturnValueOnce('new-access-token')
      .mockReturnValueOnce('new-refresh-token');

    const result = await service.refreshSession('old-refresh-token');

    expect(result).toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('old-refresh-token', {
      secret: 'super-secret-value',
    });
  });

  it('rejects invalid refresh tokens', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('bad token'));

    await expect(service.refreshSession('bad-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
