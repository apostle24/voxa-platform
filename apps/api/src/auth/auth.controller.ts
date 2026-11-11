import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { JwtAuthGuard, AuthenticatedRequest } from './jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

type AuthHttpRequest = { headers: { cookie?: string; origin?: string } };
type AuthHttpResponse = {
  cookie(name: string, value: string, options: { httpOnly: boolean; secure: boolean; sameSite: 'lax' | 'none'; path: string; maxAge?: number }): void;
  clearCookie(name: string, options: { httpOnly: boolean; secure: boolean; sameSite: 'lax' | 'none'; path: string }): void;
};

const REFRESH_COOKIE = 'voxa_refresh';
const COOKIE_PATH = '/v1/auth';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @UseGuards(AuthRateLimitGuard)
  async register(@Body() input: RegisterDto, @Req() request: AuthHttpRequest, @Res({ passthrough: true }) response: AuthHttpResponse) {
    this.assertTrustedOrigin(request);
    return this.withRefreshCookie(await this.auth.register(input), response);
  }

  @Post('login')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async login(@Body() input: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertTrustedOrigin(request);
    return this.withRefreshCookie(await this.auth.login(input), response);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertTrustedOrigin(request);
    return this.withRefreshCookie(await this.auth.refresh(this.readRefreshCookie(request)), response);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertTrustedOrigin(request);
    await this.auth.logout(this.readRefreshCookie(request));
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { success: true };
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(@Req() request: AuthenticatedRequest & AuthHttpRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.logoutAll(request.user.id);
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
    if (!value) return '';
    try { return decodeURIComponent(value); } catch { return ''; }
  }

  private assertTrustedOrigin(request: Request) {
    const origin = request.headers.origin;
    if (!origin) return;
    const allowed = (process.env.CORS_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    if (!allowed.includes(origin)) throw new ForbiddenException('Request origin is not allowed');
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
      path: COOKIE_PATH,
    };
  }
}
