import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger('Bootstrap');

  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL 未配置：请复制 .env.example 为 .env 并填写数据库连接串');
  }
  if (config.isProd && config.jwt.secret.startsWith('dev-only')) {
    logger.warn('检测到开发用 JWT 密钥，生产环境请通过 JWT_SECRET / JWT_REFRESH_SECRET 注入随机值');
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app, config);

  await app.listen(config.port, '0.0.0.0');
  logger.log(`API 已启动：http://0.0.0.0:${config.port}/${config.apiPrefix}（env=${config.nodeEnv}）`);
}

void bootstrap();
