import { Inject, Injectable } from '@nestjs/common';
import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import type Redis from 'ioredis';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check() {
    const [dbOk, redisOk] = await Promise.all([this.prisma.ping(), this.pingRedis()]);

    if (!dbOk) {
      throw new ServiceUnavailableException({
        code: 'DB_UNAVAILABLE',
        message: '数据库不可用',
      });
    }

    return {
      status: redisOk ? 'ok' : 'degraded',
      db: 'up',
      redis: redisOk ? 'up' : 'down',
      uptimeSeconds: Math.round(process.uptime()),
      version: process.env.APP_VERSION ?? 'dev',
      time: new Date().toISOString(),
    };
  }

  private async pingRedis(): Promise<boolean> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }
}
