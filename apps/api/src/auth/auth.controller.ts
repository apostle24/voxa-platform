import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { JwtAuthGuard, AuthenticatedRequest } from './jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AccountSecurityService } from './account-security.service';
import { EmailDto } from './dto/email.dto';
import { EmailTokenDto } from './dto/email-token.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { MfaCodeDto } from './dto/mfa-code.dto';
import { PasswordResetDto } from './dto/password-reset.dto';
import { MfaService } from './mfa.service';
import { UpdateAccountProfileDto } from './dto/update-account-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { MobileRefreshDto } from './dto/mobile-refresh.dto';

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
  constructor(private readonly auth: AuthService, private readonly accountSecurity: AccountSecurityService, private readonly mfa: MfaService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMyProfile(@Req() request: AuthenticatedRequest) {
    return this.auth.getMyProfile(request.user.id);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMyProfile(@Req() request: AuthenticatedRequest, @Body() input: UpdateAccountProfileDto) {
    return this.auth.updateMyProfile(request.user.id, input.displayName);
  }

  @Patch('password')
  @UseGuards(JwtAuthGuard)
  async changePassword(@Req() request: AuthenticatedRequest, @Body() input: ChangePasswordDto, @Res({ passthrough: true }) response: AuthHttpResponse) {
    const result = await this.auth.changePassword(request.user.id, input.currentPassword, input.newPassword);
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return result;
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  listSessions(@Req() request: AuthenticatedRequest) {
    return this.auth.listSessions(request.user.id);
  }

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard)
  revokeSession(@Req() request: AuthenticatedRequest, @Param('sessionId') sessionId: string) {
    return this.auth.revokeSession(request.user.id, sessionId);
  }

  @Post('register')
  @UseGuards(AuthRateLimitGuard)
  async register(@Body() input: RegisterDto, @Req() request: AuthHttpRequest, @Res({ passthrough: true }) response: AuthHttpResponse) {
    this.assertTrustedOrigin(request);
    const result = await this.auth.register(input);
    try {
      await this.accountSecurity.requestEmailVerification(input.email);
    } catch {
      // Registration remains successful if email delivery is temporarily unavailable.
    }
    return result;
  }

  @Post('login')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async login(@Body() input: LoginDto, @Req() request: AuthHttpRequest, @Res({ passthrough: true }) response: AuthHttpResponse) {
    this.assertTrustedOrigin(request);
    const result = await this.auth.login(input);
    if ('refreshToken' in result) return this.withRefreshCookie(result, response);
    return result;
  }

  // Native clients keep the rotating refresh credential in OS-backed secure storage.
  // Browser clients must continue using the HttpOnly cookie endpoints above.
  @Post('mobile/login')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  mobileLogin(@Body() input: LoginDto) {
    return this.auth.login(input);
  }

  @Post('mobile/mfa/challenge')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async mobileMfaChallenge(@Body() input: MfaVerifyDto) {
    const user = await this.mfa.verifyLoginChallenge(input.token, input.code);
    return this.auth.issueAuthenticatedSession(user);
  }

  @Post('mobile/refresh')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  mobileRefresh(@Body() input: MobileRefreshDto) {
    return this.auth.refresh(input.refreshToken);
  }

  @Post('mobile/logout')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  mobileLogout(@Body() input: MobileRefreshDto) {
    return this.auth.logout(input.refreshToken);
  }

  @Post('mfa/setup')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  beginMfaSetup(@Req() request: AuthenticatedRequest) {
    return this.mfa.beginSetup(request.user.id, request.user.email);
  }

  @Post('mfa/enable')
  @UseGuards(JwtAuthGuard, AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  enableMfa(@Req() request: AuthenticatedRequest, @Body() input: MfaCodeDto) {
    return this.mfa.enable(request.user.id, input.token);
  }

  @Post('mfa/disable')
  @UseGuards(JwtAuthGuard, AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  disableMfa(@Req() request: AuthenticatedRequest, @Body() input: MfaCodeDto) {
    return this.mfa.disable(request.user.id, input.token);
  }

  @Post('mfa/challenge')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async verifyMfaChallenge(@Body() input: MfaVerifyDto, @Res({ passthrough: true }) response: AuthHttpResponse) {
    const user = await this.mfa.verifyLoginChallenge(input.token, input.code);
    return this.withRefreshCookie(await this.auth.issueAuthenticatedSession(user), response);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: AuthHttpRequest, @Res({ passthrough: true }) response: AuthHttpResponse) {
    this.assertTrustedOrigin(request);
    return this.withRefreshCookie(await this.auth.refresh(this.readRefreshCookie(request)), response);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() request: AuthHttpRequest, @Res({ passthrough: true }) response: AuthHttpResponse) {
    this.assertTrustedOrigin(request);
    await this.auth.logout(this.readRefreshCookie(request));
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { success: true };
  }

  @Post('verification/request')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  requestEmailVerification(@Body() input: EmailDto) {
    return this.accountSecurity.requestEmailVerification(input.email);
  }

  @Post('verification/confirm')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  confirmEmailVerification(@Body() input: EmailTokenDto) {
    return this.accountSecurity.confirmEmailVerification(input.token);
  }

  @Post('password/forgot')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  requestPasswordReset(@Body() input: EmailDto) {
    return this.accountSecurity.requestPasswordReset(input.email);
  }

  @Post('password/reset')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() input: PasswordResetDto) {
    return this.accountSecurity.resetPassword(input.token, input.password);
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(@Req() request: AuthenticatedRequest & AuthHttpRequest, @Res({ passthrough: true }) response: AuthHttpResponse) {
    await this.auth.logoutAll(request.user.id);
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { success: true };
  }

  private withRefreshCookie(result: { refreshToken: string; [key: string]: unknown }, response: AuthHttpResponse) {
    response.cookie(REFRESH_COOKIE, result.refreshToken, { ...this.cookieOptions(), maxAge: COOKIE_MAX_AGE });
    const { refreshToken: _refreshToken, ...publicResult } = result;
    return publicResult;
  }

  private readRefreshCookie(request: AuthHttpRequest): string {
    const value = (request.headers.cookie ?? '').split(';').map((part) => part.trim())
      .find((part) => part.startsWith(REFRESH_COOKIE + '='))
      ?.slice(REFRESH_COOKIE.length + 1);
    if (!value) return '';
    try { return decodeURIComponent(value); } catch { return ''; }
  }

  private assertTrustedOrigin(request: AuthHttpRequest) {
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
