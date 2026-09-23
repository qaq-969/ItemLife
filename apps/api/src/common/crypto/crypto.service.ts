import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { RECOVERY_CODE_COUNT } from '@itemlife/shared';

const AES_ALGORITHM = 'aes-256-gcm';
const AES_IV_BYTES = 12;
/** 密钥版本前缀：轮换 AES 主密钥时按前缀区分新旧密文，便于平滑迁移 */
const AES_KEY_VERSION = 'v1';

const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const RECOVERY_CODE_LENGTH = 10;

/**
 * 凭据密码学工具（设计报告 7.1 的落地）：
 * - 登录密码：Argon2id 单向哈希（OWASP 推荐参数）
 * - TOTP 密钥：AES-256-GCM 可逆加密（服务端需解密后校验动态码）
 * - 恢复码 / 刷新令牌：SHA-256 哈希比对
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly aesKey: Buffer;
  private readonly recoveryPepper: Buffer;
  private dummyHash: string | null = null;

  constructor(private readonly configService: ConfigService) {
    this.aesKey = this.resolveAesKey();
    // 恢复码哈希 pepper 由 AES 主密钥派生，避免再引入一个必填密钥
    this.recoveryPepper = createHash('sha256').update(`recovery-code:${this.aesKey.toString('base64')}`).digest();
  }

  private resolveAesKey(): Buffer {
    const raw = this.configService.get<string>('totpEncKey') ?? '';
    if (raw) {
      const decoded = Buffer.from(raw, 'base64');
      if (decoded.length === 32) return decoded;
      this.logger.warn('TOTP_ENC_KEY 不是 base64 的 32 字节，已按其内容派生 SHA-256 密钥');
      return createHash('sha256').update(raw).digest();
    }
    if (this.configService.get<boolean>('isProd')) {
      throw new Error('TOTP_ENC_KEY 未配置：生产环境必须提供 base64 编码的 32 字节 AES 主密钥');
    }
    this.logger.warn('未配置 TOTP_ENC_KEY，开发环境暂以 JWT_SECRET 派生密钥（切勿用于生产）');
    return createHash('sha256').update(String(this.configService.get('jwt.secret'))).digest();
  }

  /** Argon2id：m=19456 KiB, t=2, p=1，每用户独立随机盐（由 argon2 自动生成并写入哈希串） */
  hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verifyPassword(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /** 账号不存在时的等价比对：抹平响应耗时差异，避免通过时序探测账号是否存在 */
  async verifyPasswordDummy(plain: string): Promise<void> {
    this.dummyHash ??= await this.hashPassword(randomBytes(24).toString('hex'));
    try {
      await argon2.verify(this.dummyHash, plain);
    } catch {
      // 仅为耗时对齐，忽略结果
    }
  }

  /** 加密为 `v1.<iv>.<tag>.<密文>`（各段 base64url），GCM 自带完整性校验 */
  encryptSecret(plain: string): string {
    const iv = randomBytes(AES_IV_BYTES);
    const cipher = createCipheriv(AES_ALGORITHM, this.aesKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [
      AES_KEY_VERSION,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decryptSecret(payload: string): string {
    const [version, ivPart, tagPart, dataPart] = payload.split('.');
    if (version !== AES_KEY_VERSION || !ivPart || !tagPart || !dataPart) {
      throw new Error(`密文格式无法识别（期望 ${AES_KEY_VERSION}.<iv>.<tag>.<data>）`);
    }
    const decipher = createDecipheriv(AES_ALGORITHM, this.aesKey, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
  }

  sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /** 恢复码哈希：统一大小写与分隔符后再加 pepper，避免同一码多种写法绕过比对 */
  hashRecoveryCode(code: string): string {
    return this.sha256Hex(`${this.recoveryPepper.toString('hex')}:${normalizeRecoveryCode(code)}`);
  }

  /** 恒定时间比较，避免通过响应耗时侧信道推断 */
  safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left, 'utf8');
    const b = Buffer.from(right, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** 生成 URL 安全的随机令牌（刷新令牌原文，仅下发一次，服务端只存哈希） */
  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  /** 生成 10 个一次性恢复码，形如 `A2C4E-7HJKM`（32 进制字母表已剔除易混字符 0/O/1/I） */
  generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
    const codes = new Set<string>();
    while (codes.size < count) {
      codes.add(randomRecoveryCode());
    }
    return [...codes];
  }
}

function randomRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH);
  let raw = '';
  for (const byte of bytes) {
    raw += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
  }
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}
