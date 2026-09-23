import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditService } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { bytesToUuid, newId, toIdBytes, type IdBytes } from '../../common/utils/id';
import { MFA_TICKET_TTL_SECONDS } from './auth.constants';
import type { DeviceContext } from './device.decorator';

export interface AccessTokenPayload {
  /** 用户 ID（UUID） */
  sub: string;
  /** 会话 ID：即当前 refresh_tokens 行 ID，登出时按此吊销 */
  sid: string;
  /** 该会话是否已完成两步验证 */
  mfa: boolean;
  typ: 'access';
}

export interface MfaTicketPayload {
  sub: string;
  typ: 'mfa';
}

export interface IssuedRefreshToken {
  id: IdBytes;
  token: string;
  expiresAt: Date;
}

export interface RotatedRefreshToken extends IssuedRefreshToken {
  userId: IdBytes;
}

/** 令牌签发与刷新令牌全生命周期（轮换 / 吊销 / 盗用检测），见设计报告 7.3 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  private get accessSecret(): string {
    return this.configService.get<string>('jwt.secret') ?? '';
  }

  get accessTtlSeconds(): number {
    return this.configService.get<number>('jwt.accessTtlSeconds') ?? 900;
  }

  get refreshTtlMs(): number {
    return (this.configService.get<number>('jwt.refreshTtlDays') ?? 14) * 24 * 60 * 60 * 1000;
  }

  signAccessToken(params: { userId: string; sessionId: string; mfa: boolean }): Promise<string> {
    return this.jwtService.signAsync(
      { sub: params.userId, sid: params.sessionId, mfa: params.mfa, typ: 'access' },
      { secret: this.accessSecret, expiresIn: this.accessTtlSeconds },
    );
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.accessSecret,
      });
      if (payload.typ !== 'access' || !payload.sub || !payload.sid) {
        throw new Error('载荷不完整');
      }
      return payload;
    } catch {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: '登录状态已失效，请重新登录' });
    }
  }

  /** 第一步登录成功后签发的临时票据：只能用于 /auth/mfa/verify */
  signMfaTicket(userId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, typ: 'mfa' },
      { secret: this.accessSecret, expiresIn: MFA_TICKET_TTL_SECONDS },
    );
  }

  async verifyMfaTicket(ticket: string): Promise<MfaTicketPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<MfaTicketPayload>(ticket, { secret: this.accessSecret });
      if (payload.typ !== 'mfa' || !payload.sub) throw new Error('载荷不完整');
      return payload;
    } catch {
      throw new UnauthorizedException({
        code: 'MFA_TICKET_INVALID',
        message: '两步验证票据已失效，请重新登录',
      });
    }
  }

  /** 新建会话：生成随机刷新令牌，落库仅存 SHA-256 哈希 */
  async issueRefreshToken(userId: IdBytes, device: DeviceContext): Promise<IssuedRefreshToken> {
    const token = this.crypto.randomToken();
    const id = newId();
    const expiresAt = new Date(Date.now() + this.refreshTtlMs);

    await this.prisma.refreshToken.create({
      data: {
        id,
        userId,
        tokenHash: this.crypto.sha256Hex(token),
        deviceName: device.userAgent ? truncate(parseDeviceName(device.userAgent), 100) : null,
        ip: device.ip ? truncate(device.ip, 45) : null,
        userAgent: device.userAgent ? truncate(device.userAgent, 255) : null,
        expiresAt,
      },
    });

    return { id, token, expiresAt };
  }

  /**
   * 刷新令牌旋转：旧令牌立即吊销，新令牌继承同一会话链（rotated_from）。
   * 若检测到「已吊销令牌被复用」，视为令牌泄露，整条会话链全部吊销并强制重新登录。
   */
  async rotateRefreshToken(rawToken: string, device: DeviceContext): Promise<RotatedRefreshToken> {
    const tokenHash = this.crypto.sha256Hex(rawToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!record) {
      throw new UnauthorizedException({ code: 'REFRESH_TOKEN_INVALID', message: '登录状态已失效，请重新登录' });
    }

    if (record.revokedAt) {
      const { found, revoked } = await this.revokeDescendants(record.id);
      // 无派生令牌 = 该会话是被主动吊销的（登出 / 全端下线），客户端拿着旧 Cookie 属正常竞态，
      // 按普通失效处理；有派生令牌才是「旋转后被重放」，判定为令牌泄露。
      if (found === 0) {
        throw new UnauthorizedException({ code: 'REFRESH_TOKEN_INVALID', message: '登录状态已失效，请重新登录' });
      }
      this.audit.record('auth.token.reuse_detected', {
        userId: bytesToUuid(record.userId),
        tokenId: bytesToUuid(record.id),
        descendantCount: found,
        revokedCount: revoked,
        ip: device.ip,
      });
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REUSED',
        message: '检测到异常登录，已注销全部会话，请重新登录',
      });
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      await this.prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException({ code: 'REFRESH_TOKEN_EXPIRED', message: '登录状态已过期，请重新登录' });
    }

    const token = this.crypto.randomToken();
    const id = newId();
    const expiresAt = new Date(Date.now() + this.refreshTtlMs);

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } }),
      this.prisma.refreshToken.create({
        data: {
          id,
          userId: record.userId,
          tokenHash: this.crypto.sha256Hex(token),
          deviceName: device.userAgent ? truncate(parseDeviceName(device.userAgent), 100) : record.deviceName,
          ip: device.ip ? truncate(device.ip, 45) : record.ip,
          userAgent: device.userAgent ? truncate(device.userAgent, 255) : record.userAgent,
          expiresAt,
          rotatedFrom: record.id,
        },
      }),
    ]);

    return { id, token, expiresAt, userId: record.userId };
  }

  /** 按会话 ID 吊销（登出当前设备） */
  async revokeSession(sessionId: string): Promise<void> {
    const id = toIdBytes(sessionId);
    if (!id) return;
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** 吊销该用户全部会话（登出所有设备 / 改密后强制下线） */
  async revokeAllSessions(userId: string): Promise<number> {
    const id = toIdBytes(userId);
    if (!id) return 0;
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  refreshMaxAgeMs(): number {
    return this.refreshTtlMs;
  }

  /**
   * 沿 rotated_from 链向前吊销全部派生令牌（盗用响应：整族下线）。
   * found 为发现的派生令牌总数（含已吊销的），revoked 为本次真正吊销的数量。
   */
  private async revokeDescendants(rootId: IdBytes): Promise<{ found: number; revoked: number }> {
    let found = 0;
    let revoked = 0;
    let frontier: IdBytes[] = [rootId];

    // 每次旋转只派生一个子令牌，链条为线性，深度上限用于防御异常数据造成的环
    for (let depth = 0; depth < 100 && frontier.length > 0; depth += 1) {
      const children = await this.prisma.refreshToken.findMany({
        where: { rotatedFrom: { in: frontier } },
        select: { id: true },
      });
      if (children.length === 0) break;
      const ids = children.map((child) => child.id);
      const result = await this.prisma.refreshToken.updateMany({
        where: { id: { in: ids }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      found += ids.length;
      revoked += result.count;
      frontier = ids;
    }

    return { found, revoked };
  }
}

/** 从 UA 中提取一个便于识别的设备名（不引入 UA 解析依赖） */
function parseDeviceName(userAgent: string): string {
  const platform = /Windows NT|Macintosh|Android|iPhone|iPad|Linux/i.exec(userAgent)?.[0] ?? '未知设备';
  const browser =
    /Edg\/[\d.]+|Chrome\/[\d.]+|Firefox\/[\d.]+|Safari\/[\d.]+/i.exec(userAgent)?.[0]?.split('/')[0] ?? '未知浏览器';
  return `${platform} · ${browser}`;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
