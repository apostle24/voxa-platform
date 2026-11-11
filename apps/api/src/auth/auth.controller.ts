import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const REFRESH_COOKIE = 'voxa_refresh';
const COOKIE_PATH = '/v1/auth';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

@Controller('auth')
@UseGuards(AuthRateLimitGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body() input: RegisterDto, @Res({ passthrough: true }) response: Response) {
    return this.withRefreshCookie(await this.auth.register(input), response);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() input: LoginDto, @Res({ passthrough: true }) response: Response) {
    return this.withRefreshCookie(await this.auth.login(input), response);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.withRefreshCookie(await this.auth.refresh(this.readRefreshCookie(request)), response);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(this.readRefreshCookie(request));
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { success: true };
  }

  private withRefreshCookie(result: { refreshToken: string; [key: string]: unknown }, response: Response) {
    response.cookie(REFRESH_COOKIE, result.refreshToken, { ...this.cookieOptions(), maxAge: COOKIE_MAX_AGE });
    const { refreshToken: _refreshToken, ...publicResult } = result;
    return publicResult;
  }

  private readRefreshCookie(request: Request): string {
    const value = (request.headers.cookie ?? '').split(';').map((part) => part.trim())
      .find((part) => part.startsWith(REFRESH_COOKIE + '='))
      ?.slice(REFRESH_COOKIE.length + 1);
    return value ? decodeURIComponent(value) : '';
  }

  private cookieOptions() {
    return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: COOKIE_PATH };
  }
}
