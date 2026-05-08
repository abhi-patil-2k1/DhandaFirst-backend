import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '@/common/decorators/current-user.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';

@ApiTags('auth')
@Controller('api/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Get('google')
  googleAuth(@Res() res: Response) {
    const authUrl = this.authService.getGoogleAuthUrl();
    this.logger.log(JSON.stringify({ event: 'google_auth_redirect', authUrl }));
    res.redirect(authUrl);
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    if (error) {
      throw new BadRequestException(`Google OAuth failed: ${error}`);
    }

    if (!code) {
      throw new BadRequestException('Missing Google OAuth authorization code');
    }

    const user = await this.authService.exchangeCodeForGoogleProfile(code);

    this.logger.log(
      JSON.stringify({
        event: 'google_callback_req_user',
        email: user.email,
        googleId: user.googleId,
        hasAccessToken: Boolean(user.accessToken),
        hasRefreshToken: Boolean(user.refreshToken),
      }),
    );

    const result = await this.authService.handleGoogleLogin(user);

    const frontendUrl = this.configService.get<string>('FRONTEND_URL')!;
    res.redirect(
      `${frontendUrl}/auth/callback?token=${result.accessToken}&refresh=${result.refreshToken}`,
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async getProfile(@CurrentUser() user: JwtPayload) {
    const profile = await this.authService.getUserById(user.sub);
    return { success: true, data: profile };
  }
}
