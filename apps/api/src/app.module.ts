import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { loadConfig } from './config/configuration';
import { AuditModule } from './common/audit/audit.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../../.env'],
      load: [loadConfig],
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const config = loadConfig();
        return {
          throttlers: [{ ttl: config.throttle.ttlSeconds * 1000, limit: config.throttle.limit }],
        };
      },
    }),
    AuditModule,
    CryptoModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    // 后续模块（M2+）：LedgerModule / ItemModule / FamilyModule / DashboardModule / UserModule
  ],
  providers: [
    // 全局限流（默认额度见 THROTTLE_* 环境变量），端点可用 @Throttle 收紧、@SkipThrottle 放开
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // 全局登录守卫：默认全部端点需认证，公开端点用 @Public() 显式放行
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
