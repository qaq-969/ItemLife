import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { loadConfig } from './config/configuration';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
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
    PrismaModule,
    RedisModule,
    HealthModule,
    // 后续模块（M1+）：AuthModule / LedgerModule / ItemModule / FamilyModule / DashboardModule / UserModule
  ],
})
export class AppModule {}
