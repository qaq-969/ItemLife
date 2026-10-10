import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { REFRESH_COOKIE_NAME } from '@itemlife/shared';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user';
import { clearRefreshCookieOptions, refreshCookieOptions } from './auth.cookie';
import { AuthService, type IssuedSession, type LoginOutcome } from './auth.service';
import { Device, type DeviceContext } from './device.decorator';
import { LoginDto, RegisterDto, UpdateProfileDto } from './dto/auth.dto';
import { AuthSessionVo, AuthUserVo, LoginResultVo, MfaEnableVo, MfaSetupVo } from './dto/auth.vo';
import { MfaDisableDto, MfaEnableDto, MfaVerifyDto } from './dto/mfa.dto';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: '注册：邮箱 + 密码（Argon2id 入库，密码强度服务端二次校验）' })
  register(@Body() dto: RegisterDto, @Device() device: DeviceContext): Promise<AuthUserVo> {
    return this.authService.register(dto, device);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOperation({ summary: '登录第一步：校验密码；已开启两步验证则返回 5 分钟短期票据' })
  async login(
    @Body() dto: LoginDto,
    @Device() device: DeviceContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResultVo> {
    const outcome = await this.authService.login(dto, device);
    const result = new LoginResultVo();
    result.mfaRequired = outcome.mfaRequired;

    if (outcome.mfaRequired) {
      result.mfaTicket = outcome.mfaTicket;
      return result;
    }

    this.writeRefreshCookie(request, response, outcome.session);
    result.accessToken = outcome.session.session.accessToken;
    result.user = outcome.session.session.user;
    return result;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('mfa/verify')
  @ApiOperation({ summary: '登录第二步：校验 6 位动态码或恢复码，签发正式令牌对' })
  async verifyMfa(
    @Body() dto: MfaVerifyDto,
    @Device() device: DeviceContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionVo> {
    const issued = await this.authService.verifyMfa(dto, device);
    this.writeRefreshCookie(request, response, issued);
    return issued.session;
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('token/refresh')
  @ApiOperation({ summary: '刷新令牌旋转：旧令牌吊销；检测到复用则整族吊销' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Device() device: DeviceContext,
  ): Promise<AuthSessionVo> {
    const cookieToken = readRefreshCookie(request);
    const issued = await this.authService.refresh(cookieToken, device);
    this.writeRefreshCookie(request, response, issued);
    return issued.session;
  }

  @ApiBearerAuth()
  @Post('mfa/setup')
  @ApiOperation({ summary: '生成 TOTP 密钥与二维码（绑定中的密钥仅暂存服务端，不落库）' })
  setupMfa(@CurrentUser() user: AuthenticatedUser): Promise<MfaSetupVo> {
    return this.authService.createMfaSetup(user.id);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/enable')
  @ApiOperation({ summary: '提交一次有效动态码确认开启；返回 10 个恢复码（仅此一次）' })
  enableMfa(@CurrentUser() user: AuthenticatedUser, @Body() dto: MfaEnableDto): Promise<MfaEnableVo> {
    return this.authService.enableMfa(user.id, dto.code);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/disable')
  @ApiOperation({ summary: '关闭两步验证（密码 + 动态码双验证）' })
  disableMfa(@CurrentUser() user: AuthenticatedUser, @Body() dto: MfaDisableDto): Promise<null> {
    return this.authService.disableMfa(user.id, dto.password, dto.code);
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  @ApiOperation({ summary: '登出当前设备：吊销本次会话的刷新令牌' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<null> {
    response.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions(request));
    return this.authService.logout(user.sessionId);
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Post('logout-all')
  @ApiOperation({ summary: '登出全部设备' })
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<null> {
    response.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions(request));
    return this.authService.logoutAll(user.id);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: '当前登录用户资料' })
  me(@CurrentUser() user: AuthenticatedUser): Promise<AuthUserVo> {
    return this.authService.profile(user.id);
  }

  @ApiBearerAuth()
  @Patch('me')
  @ApiOperation({ summary: '修改当前用户昵称' })
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto): Promise<AuthUserVo> {
    return this.authService.updateProfile(user.id, dto.nickname);
  }

  private writeRefreshCookie(request: Request, response: Response, issued: IssuedSession): void {
    response.cookie(
      REFRESH_COOKIE_NAME,
      issued.refreshToken,
      refreshCookieOptions(request, issued.refreshMaxAgeMs),
    );
  }
}

function readRefreshCookie(request: Request): string | undefined {
  const cookies = request.cookies as Record<string, string> | undefined;
  return cookies?.[REFRESH_COOKIE_NAME];
}
