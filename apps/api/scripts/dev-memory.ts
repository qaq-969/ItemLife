/**
 * 本地预演：用内存替身启动真实 API（无需 MySQL / Redis），配合 `pnpm dev:web` 看前端效果。
 * 数据只存在进程内存中，重启即清空，仅供本地预览与联调，不用于验证持久化。
 *
 * 运行：pnpm --filter @itemlife/api dev:memory
 */
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { loadConfig } from '../src/config/configuration';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/common/redis/redis.module';
import { createInMemoryPrisma, createInMemoryRedis } from './support/in-memory';

async function main(): Promise<void> {
  // 让本进程与容器内的行为一致：先读仓库根目录的 .env，再解析配置
  const envFile = resolve(__dirname, '../../../.env');
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
  process.env.TRUST_PROXY ??= '0';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(createInMemoryPrisma())
    .overrideProvider(REDIS_CLIENT)
    .useValue(createInMemoryRedis())
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  const config = loadConfig();
  configureApp(app, config);
  await app.listen(config.port, '127.0.0.1');

  const logger = new Logger('DevMemory');
  logger.log(`API 已启动：http://127.0.0.1:${config.port}/${config.apiPrefix}（Swagger：http://127.0.0.1:${config.port}/api/docs）`);
  logger.warn('存储使用内存替身：数据重启即清空，仅供本地预览');
}

void main().catch((error) => {
  console.error('本地内存模式启动失败：', error);
  process.exit(1);
});
