import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { checkPasswordStrength } from '@itemlife/shared';
import { AuditService } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { seedPresetCategories } from '../categories/category-presets';
import { bytesToUuid, newId, toIdBytes } from '../../common/utils/id';
import { maskEmail } from '../../common/utils/mask';
import type { LoginDto, RegisterDto } from './dto/auth.dto';
import { AuthSessionVo, AuthUserVo, LoginResultVo, MfaEnableVo, MfaSetupVo } from './dto/auth.vo';
import type { MfaVerifyDto } from './dto/mfa.dto';
import type { DeviceContext } from './device.decorator';
import { LoginThrottleService } from './login-throttle.service';
import { MfaService } from './mfa.service';
import { TokenService } from './token.service';

export interface IssuedSession {
  session: AuthSessionVo;
  /** 刷新令牌原文：由控制器写入 HttpOnly Cookie，服务端只存哈希 */
  refreshToken: string;
  refreshMaxAgeMs: number;
}

/** 登录第一步的两种结果：需要第二步票据，或（未开 MFA）直接拿到会话 */
export type LoginOutcome =
  | { mfaRequired: true; mfaTicket: string }
  | { mfaRequired: false; session: IssuedSession };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly tokenService: TokenService,
    private readonly mfaService: MfaService,
    private readonly throttle: LoginThrottleService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto, device: DeviceContext): Promise<AuthUserVo> {
    const email = normalizeEmail(dto.email);
    const strength = checkPasswordStrength(dto.password);
    if (!strength.ok) {
      throw new BadRequestException({
        code: 'PASSWORD_TOO_WEAK',
        message: `密码强度不足：${strength.issues.join('、')}`,
      });
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException({ code: 'EMAIL_TAKEN', message: '该邮箱已注册，请直接登录' });
    }

    const passwordHash = await this.crypto.hashPassword(dto.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          id: newId(),
          email,
          passwordHash,
          nickname: dto.nickname?.trim() || null,
        },
      });
      // 预置分类随注册一次性复制到个人数据域（设计报告 5.2 ⑦），失败则整体回滚
      await seedPresetCategories(tx, { ownerType: 'user', ownerId: created.id });
      return created;
    });

    this.audit.record('auth.register', { userId: bytesToUuid(user.id), email: maskEmail(email), ip: device.ip });
    return AuthUserVo.from(user);
  }

  /** 登录第一步：校验密码；已开 MFA 则只返回短期票据，否则直接签发会话 */
  async login(dto: LoginDto, device: DeviceContext): Promise<LoginOutcome> {
    const email = normalizeEmail(dto.email);
    const scope = this.throttle.scopeOf(email, device.ip);
    await this.throttle.assertNotLocked(scope);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) {
      // 账号不存在时也走一次哈希比对，抹平响应耗时差异，避免账号枚举
      await this.crypto.verifyPasswordDummy(dto.password);
      await this.throttle.recordFailure(scope, { email, ip: device.ip });
      throw invalidCredentials();
    }

    if (!(await this.crypto.verifyPassword(user.passwordHash, dto.password))) {
      await this.throttle.recordFailure(scope, { email, ip: device.ip });
      throw invalidCredentials();
    }

    await this.throttle.clearFailures(scope);
    this.audit.record('auth.login.success', {
      userId: bytesToUuid(user.id),
      mfaEnabled: user.mfaEnabled,
      ip: device.ip,
    });

    if (user.mfaEnabled) {
      return { mfaRequired: true, mfaTicket: await this.tokenService.signMfaTicket(bytesToUuid(user.id)) };
    }

    return { mfaRequired: false, session: await this.createSession(user, device) };
  }

  /** 登录第二步：校验动态码 / 恢复码后签发正式会话 */
  async verifyMfa(dto: MfaVerifyDto, device: DeviceContext): Promise<IssuedSession> {
    const ticket = await this.tokenService.verifyMfaTicket(dto.mfaTicket);
    const userId = toIdBytes(ticket.sub);
    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId } }) : null;
    if (!user || user.deletedAt || !user.mfaEnabled) {
      throw new UnauthorizedException({
        code: 'MFA_TICKET_INVALID',
        message: '两步验证票据已失效，请重新登录',
      });
    }

    const scope = this.throttle.scopeOf(user.email, device.ip);
    await this.throttle.assertNotLocked(scope);

    if (!(await this.mfaService.verifyChallenge(user, dto.code))) {
      await this.throttle.recordFailure(scope, { email: user.email, ip: device.ip });
      throw new UnauthorizedException({ code: 'INVALID_MFA_CODE', message: '动态码或恢复码不正确' });
    }

    await this.throttle.clearFailures(scope);
    this.audit.record('auth.mfa.verified', { userId: bytesToUuid(user.id), ip: device.ip });
    return this.createSession(user, device);
  }

  /** 刷新令牌旋转：旧令牌吊销，签发新令牌对 */
  async refresh(rawToken: string | undefined, device: DeviceContext): Promise<IssuedSession> {
    if (!rawToken) {
      throw new UnauthorizedException({ code: 'REFRESH_TOKEN_MISSING', message: '登录状态已失效，请重新登录' });
    }

    const rotated = await this.tokenService.rotateRefreshToken(rawToken, device);
    const user = await this.prisma.user.findUnique({ where: { id: rotated.userId } });
    if (!user || user.deletedAt) {
      await this.tokenService.revokeSession(bytesToUuid(rotated.id));
      throw new UnauthorizedException({ code: 'REFRESH_TOKEN_INVALID', message: '登录状态已失效，请重新登录' });
    }

    const accessToken = await this.tokenService.signAccessToken({
      userId: bytesToUuid(user.id),
      sessionId: bytesToUuid(rotated.id),
      mfa: true,
    });

    const session = new AuthSessionVo();
    session.accessToken = accessToken;
    session.expiresIn = this.tokenService.accessTtlSeconds;
    session.user = AuthUserVo.from(user);

    return { session, refreshToken: rotated.token, refreshMaxAgeMs: this.tokenService.refreshTtlMs };
  }

  /** 登出当前设备：吊销该会话对应的刷新令牌 */
  async logout(sessionId: string): Promise<null> {
    await this.tokenService.revokeSession(sessionId);
    this.audit.record('auth.logout', { sessionId });
    return null;
  }

  /** 登出全部设备（改密、怀疑泄露时使用） */
  async logoutAll(userId: string): Promise<null> {
    const revoked = await this.tokenService.revokeAllSessions(userId);
    this.audit.record('auth.logout_all', { userId, revoked });
    return null;
  }

  async profile(userId: string): Promise<AuthUserVo> {
    return AuthUserVo.from(await this.requireUser(userId));
  }

  async createMfaSetup(userId: string): Promise<MfaSetupVo> {
    const setup = await this.mfaService.createSetup(await this.requireUser(userId));
    return Object.assign(new MfaSetupVo(), setup);
  }

  async enableMfa(userId: string, code: string): Promise<MfaEnableVo> {
    const result = await this.mfaService.enable(await this.requireUser(userId), code);
    return Object.assign(new MfaEnableVo(), result);
  }

  async disableMfa(userId: string, password: string, code: string): Promise<null> {
    await this.mfaService.disable(await this.requireUser(userId), password, code);
    return null;
  }

  private async createSession(user: User, device: DeviceContext): Promise<IssuedSession> {
    const issued = await this.tokenService.issueRefreshToken(user.id, device);
    const accessToken = await this.tokenService.signAccessToken({
      userId: bytesToUuid(user.id),
      sessionId: bytesToUuid(issued.id),
      mfa: true,
    });

    const session = new AuthSessionVo();
    session.accessToken = accessToken;
    session.expiresIn = this.tokenService.accessTtlSeconds;
    session.user = AuthUserVo.from(user);

    return { session, refreshToken: issued.token, refreshMaxAgeMs: this.tokenService.refreshTtlMs };
  }

  private async requireUser(userId: string): Promise<User> {
    const id = toIdBytes(userId);
    const user = id ? await this.prisma.user.findUnique({ where: { id } }) : null;
    if (!user || user.deletedAt) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: '登录状态已失效，请重新登录' });
    }
    return user;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 统一的登录失败响应：不区分「账号不存在」与「密码错误」 */
function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: '邮箱或密码不正确' });
}
