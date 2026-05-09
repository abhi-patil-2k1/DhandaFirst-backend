import {
  Body,
  BadRequestException,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '@/common/decorators/current-user.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import {
  ACCESS_TOKEN_COOKIE,
  OAUTH_STATE_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from './auth.constants';

interface RefreshSessionDto {
  refreshToken?: string;
}

@ApiTags('auth')
@Controller('api/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Get('google')
  googleAuth(@Res() res: Response) {
    const state = this.authService.generateOAuthState();
    const authUrl = this.authService.getGoogleAuthUrl(state);

    res.cookie(
      OAUTH_STATE_COOKIE,
      state,
      this.authService.getOAuthStateCookieOptions(),
    );
    res.redirect(authUrl);
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    if (error) {
      this.clearOAuthStateCookie(res);
      this.logger.warn(`Google OAuth denied: ${error}`);
      return res.redirect(
        HttpStatus.FOUND,
        this.authService.buildFrontendAuthRedirect({ error: 'google_oauth_denied' }),
      );
    }

    if (!code) {
      throw new BadRequestException('Missing Google OAuth authorization code');
    }

    const expectedState = res.req.cookies?.[OAUTH_STATE_COOKIE];
    if (!state || !expectedState || state !== expectedState) {
      this.clearOAuthStateCookie(res);
      throw new BadRequestException('Invalid OAuth state');
    }

    this.clearOAuthStateCookie(res);
    try {
      const user = await this.authService.exchangeCodeForGoogleProfile(code);
      const result = await this.authService.handleGoogleLogin(user);

      if (this.authService.shouldUseCookieTransport()) {
        res.cookie(
          ACCESS_TOKEN_COOKIE,
          result.accessToken,
          this.authService.getSessionCookieOptions('access'),
        );
        res.cookie(
          REFRESH_TOKEN_COOKIE,
          result.refreshToken,
          this.authService.getSessionCookieOptions('refresh'),
        );
      }

      return res.redirect(
        HttpStatus.FOUND,
        this.authService.buildFrontendAuthRedirect({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        }),
      );
    } catch (callbackError) {
      this.logger.error(
        'Google OAuth callback failed',
        callbackError instanceof Error ? callbackError.stack : undefined,
      );
      return res.redirect(
        HttpStatus.FOUND,
        this.authService.buildFrontendAuthRedirect({ error: 'google_oauth_failed' }),
      );
    }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async getProfile(@CurrentUser() user: JwtPayload) {
    const profile = await this.authService.getUserById(user.sub);
    return { success: true, data: profile };
  }

  @Post('refresh')
  async refreshSession(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: RefreshSessionDto,
  ) {
    const refreshToken =
      req.cookies?.[REFRESH_TOKEN_COOKIE] ??
      body.refreshToken;

    if (!refreshToken) {
      throw new BadRequestException('Missing refresh token');
    }

    const tokens = await this.authService.refreshSession(refreshToken);

    if (this.authService.shouldUseCookieTransport()) {
      res.cookie(
        ACCESS_TOKEN_COOKIE,
        tokens.accessToken,
        this.authService.getSessionCookieOptions('access'),
      );
      res.cookie(
        REFRESH_TOKEN_COOKIE,
        tokens.refreshToken,
        this.authService.getSessionCookieOptions('refresh'),
      );
    }

    return res.status(HttpStatus.OK).json({
      success: true,
      data: this.authService.shouldUseCookieTransport()
        ? { refreshed: true }
        : tokens,
    });
  }

  @Post('logout')
  logout(@Res() res: Response) {
    res.clearCookie(
      ACCESS_TOKEN_COOKIE,
      this.authService.getSessionCookieOptions('access'),
    );
    res.clearCookie(
      REFRESH_TOKEN_COOKIE,
      this.authService.getSessionCookieOptions('refresh'),
    );
    this.clearOAuthStateCookie(res);

    return res.status(HttpStatus.OK).json({
      success: true,
      message: 'Logged out',
    });
  }

  private clearOAuthStateCookie(res: Response) {
    res.clearCookie(
      OAUTH_STATE_COOKIE,
      this.authService.getOAuthStateCookieOptions(),
    );
  }
}
