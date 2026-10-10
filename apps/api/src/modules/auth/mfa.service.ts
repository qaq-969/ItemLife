import { BadRequestException, ConflictException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import type Redis from 'ioredis';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { AuditService } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { bytesToUuid, newId } from '../../common/utils/id';
import { MFA_SETUP_TTL_SECONDS, REDIS_KEYS, TOTP_ISSUER, TOTP_STEP_SECONDS, TOTP_WINDOW } from './auth.constants';

/** TOTP 时间步在 Redis 中的镜像保留时长 */
const TOTP_STEP_CACHE_SECONDS = 86_400;
const TOTP_CODE_PATTERN = /^\d{6}$/;

authenticator.options = { window: TOTP_WINDOW };

/**
 * TOTP 两步验证（设计报告 7.2 流程 B）：
 * 绑定中的密钥仅暂存 Redis（内存态，不落库），确认后以 AES-256-GCM 加密落库；
 * 恢复码明文只在开启时下发一次，服务端仅存加 pepper 的 SHA-256 哈希。
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async createSetup(user: User): Promise<{ secret: string; otpauthUrl: string; qrDataUrl: string }> {
    if (user.mfaEnabled) {
      throw new ConflictException({ code: 'MFA_ALREADY_ENABLED', message: '两步验证已开启' });
    }

    // 160-bit 随机密钥（Base32），兼容 Google / 微软 Authenticator
    const secret = authenticator.generateSecret();
    const userId = bytesToUuid(user.id);
    await this.redis.set(REDIS_KEYS.mfaSetup(userId), secret, 'EX', MFA_SETUP_TTL_SECONDS);

    const otpauthUrl = authenticator.keyuri(user.email, TOTP_ISSUER, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240, errorCorrectionLevel: 'M' });

    this.audit.record('auth.mfa.setup_created', { userId });
    return { secret, otpauthUrl, qrDataUrl };
  }

  async enable(user: User, code: string): Promise<{ recoveryCodes: string[] }> {
    if (user.mfaEnabled) {
      throw new ConflictException({ code: 'MFA_ALREADY_ENABLED', message: '两步验证已开启' });
    }

    const userId = bytesToUuid(user.id);
    const pendingSecret = await this.redis.get(REDIS_KEYS.mfaSetup(userId));
    if (!pendingSecret) {
      throw new BadRequestException({ code: 'MFA_SETUP_EXPIRED', message: '绑定已超时，请重新获取二维码' });
    }

    const step = matchTotpStep(pendingSecret, code);
    if (step === null) {
      this.audit.record('auth.mfa.enable_failed', { userId });
      throw new BadRequestException({ code: 'MFA_CODE_INVALID', message: '动态码不正确，请校准设备时间后重试' });
    }

    const recoveryCodes = this.crypto.generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          mfaEnabled: true,
          totpSecretEnc: Buffer.from(this.crypto.encryptSecret(pendingSecret), 'utf8'),
          totpConfirmedAt: new Date(),
          lastTotpStep: BigInt(step),
        },
      }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((recoveryCode) => ({
          id: newId(),
          userId: user.id,
          codeHash: this.crypto.hashRecoveryCode(recoveryCode),
        })),
      }),
    ]);

    await this.redis.del(REDIS_KEYS.mfaSetup(userId));
    await this.cacheTotpStep(userId, step);

    this.audit.record('auth.mfa.enabled', { userId, recoveryCodeCount: recoveryCodes.length });
    return { recoveryCodes };
  }

  /** 关闭 MFA 需「密码 + 动态码」双验证（设计报告 6.2 强验证端点） */
  async disable(user: User, password: string, code: string): Promise<void> {
    if (!user.mfaEnabled) {
      throw new BadRequestException({ code: 'MFA_NOT_ENABLED', message: '两步验证未开启' });
    }
    if (!(await this.crypto.verifyPassword(user.passwordHash, password))) {
      this.audit.record('auth.mfa.disable_failed', { userId: bytesToUuid(user.id), reason: 'password' });
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: '密码不正确' });
    }
    if (!(await this.verifyChallenge(user, code))) {
      this.audit.record('auth.mfa.disable_failed', { userId: bytesToUuid(user.id), reason: 'code' });
      throw new UnauthorizedException({ code: 'INVALID_MFA_CODE', message: '动态码或恢复码不正确' });
    }

    const userId = bytesToUuid(user.id);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { mfaEnabled: false, totpSecretEnc: null, totpConfirmedAt: null, lastTotpStep: null },
      }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
    ]);

    await this.redis.del(REDIS_KEYS.totpStep(userId));
    this.audit.record('auth.mfa.disabled', { userId });
  }

  /** 校验动态码或恢复码；成功即完成一次「消费」（时间步推进 / 恢复码标记已用） */
  async verifyChallenge(user: User, code: string): Promise<boolean> {
    const normalized = code.trim();
    if (TOTP_CODE_PATTERN.test(normalized) && user.totpSecretEnc) {
      return this.consumeTotp(user, normalized);
    }
    return this.consumeRecoveryCode(user, normalized);
  }

  private async consumeTotp(user: User, code: string): Promise<boolean> {
    if (!user.totpSecretEnc) return false;

    let secret: string;
    try {
      secret = this.crypto.decryptSecret(Buffer.from(user.totpSecretEnc).toString('utf8'));
    } catch (error) {
      this.logger.error(`TOTP 密钥解密失败（userId=${bytesToUuid(user.id)}）`, error as Error);
      return false;
    }

    const step = matchTotpStep(secret, code);
    if (step === null) return false;

    const userId = bytesToUuid(user.id);
    const lastStep = user.lastTotpStep ?? 0n;
    const cachedStep = await this.readCachedTotpStep(userId);
    // 防重放：同一时间步（含更早）的动态码二次提交一律拒绝
    if (BigInt(step) <= lastStep || (cachedStep !== null && step <= cachedStep)) {
      this.audit.record('auth.mfa.replay_detected', { userId, step });
      return false;
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastTotpStep: BigInt(step) } });
    await this.cacheTotpStep(userId, step);
    return true;
  }

  private async consumeRecoveryCode(user: User, code: string): Promise<boolean> {
    const codeHash = this.crypto.hashRecoveryCode(code);
    const record = await this.prisma.mfaRecoveryCode.findFirst({
      where: { userId: user.id, codeHash, usedAt: null },
    });
    if (!record) return false;

    await this.prisma.mfaRecoveryCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    this.audit.record('auth.mfa.recovery_code_used', { userId: bytesToUuid(user.id) });
    return true;
  }

  private async cacheTotpStep(userId: string, step: number): Promise<void> {
    try {
      await this.redis.set(REDIS_KEYS.totpStep(userId), String(step), 'EX', TOTP_STEP_CACHE_SECONDS);
    } catch (error) {
      // 防重放以 DB 的 last_totp_step 为准，缓存失败不影响安全基线
      this.logger.warn(`TOTP 时间步写缓存失败：${(error as Error).message}`);
    }
  }

  private async readCachedTotpStep(userId: string): Promise<number | null> {
    try {
      const value = await this.redis.get(REDIS_KEYS.totpStep(userId));
      if (!value) return null;
      const step = Number(value);
      return Number.isFinite(step) ? step : null;
    } catch (error) {
      this.logger.warn(`TOTP 时间步读缓存失败：${(error as Error).message}`);
      return null;
    }
  }
}

/** 校验动态码并换算成绝对时间步；无效返回 null。窗口 ±1 步容忍设备时钟漂移 */
function matchTotpStep(secret: string, code: string): number | null {
  if (!TOTP_CODE_PATTERN.test(code)) return null;
  const delta = authenticator.checkDelta(code, secret);
  if (delta === null) return null;
  const currentStep = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  return currentStep + delta;
}
