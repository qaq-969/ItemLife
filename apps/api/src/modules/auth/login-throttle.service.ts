import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { AuditService } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { maskEmail } from '../../common/utils/mask';
import { LOGIN_FAILURE_POLICY, REDIS_KEYS } from './auth.constants';

/**
 * 登录失败防护（设计报告 7.3）：按「账号 + IP」双维度计数，
 * 15 分钟内 5 次失败 → 指数退避锁定（1min → 5min → 15min）。
 * Redis 不可用时降级放行（限流属可降级能力），但会记录告警。
 */
@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  /** 计数键：邮箱哈希（不落明文邮箱）+ 客户端 IP */
  scopeOf(email: string, ip: string | null): string {
    return `${this.crypto.sha256Hex(email.trim().toLowerCase()).slice(0, 32)}:${ip ?? 'unknown'}`;
  }

  async assertNotLocked(scope: string): Promise<void> {
    try {
      const ttlMs = await this.redis.pttl(REDIS_KEYS.loginLock(scope));
      if (ttlMs > 0) {
        const retryAfterSeconds = Math.ceil(ttlMs / 1000);
        throw new HttpException(
          {
            code: 'ACCOUNT_LOCKED',
            message: `尝试次数过多，请 ${formatDuration(retryAfterSeconds)}后重试`,
            details: { retryAfterSeconds },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.warnDegraded('assertNotLocked', error);
    }
  }

  async recordFailure(scope: string, context: { email: string; ip: string | null }): Promise<void> {
    try {
      const failKey = REDIS_KEYS.loginFail(scope);
      const failures = await this.redis.incr(failKey);
      if (failures === 1) {
        await this.redis.expire(failKey, LOGIN_FAILURE_POLICY.windowSeconds);
      }

      if (failures < LOGIN_FAILURE_POLICY.threshold) {
        this.audit.record('auth.login.failed', {
          email: maskEmail(context.email),
          ip: context.ip,
          failures,
        });
        return;
      }

      const level = await this.nextLockLevel(scope);
      const lockSeconds =
        LOGIN_FAILURE_POLICY.lockSecondsByLevel[
          Math.min(level - 1, LOGIN_FAILURE_POLICY.lockSecondsByLevel.length - 1)
        ] ?? LOGIN_FAILURE_POLICY.lockSecondsByLevel[0];
      await this.redis.set(REDIS_KEYS.loginLock(scope), String(Date.now() + lockSeconds * 1000), 'EX', lockSeconds);
      await this.redis.del(failKey);
      this.audit.record('auth.login.locked', {
        email: maskEmail(context.email),
        ip: context.ip,
        failures,
        lockSeconds,
        level,
      });
    } catch (error) {
      this.warnDegraded('recordFailure', error);
    }
  }

  async clearFailures(scope: string): Promise<void> {
    try {
      await this.redis.del(REDIS_KEYS.loginFail(scope));
    } catch (error) {
      this.warnDegraded('clearFailures', error);
    }
  }

  private async nextLockLevel(scope: string): Promise<number> {
    const levelKey = REDIS_KEYS.lockLevel(scope);
    const level = await this.redis.incr(levelKey);
    if (level === 1) {
      await this.redis.expire(levelKey, LOGIN_FAILURE_POLICY.levelTtlSeconds);
    }
    return level;
  }

  private warnDegraded(operation: string, error: unknown): void {
    this.logger.warn(`Redis 不可用，登录限流降级（${operation}）：${(error as Error).message}`);
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.ceil(seconds / 60)} 分钟`;
}
