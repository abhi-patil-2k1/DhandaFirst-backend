import {
  Controller,
  Get,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '@/common/decorators/current-user.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('auth')
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {
    // Redirects to Google
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const user = req.user as {
      googleId: string;
      email: string;
      name: string;
      avatarUrl?: string;
      accessToken: string;
      refreshToken: string;
    };

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
