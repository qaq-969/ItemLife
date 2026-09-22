import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { loadConfig } from './config/configuration';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { patchBigIntJson } from './common/utils/bigint-json';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger('Bootstrap');

  patchBigIntJson();

  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL 未配置：请复制 .env.example 为 .env 并填写数据库连接串');
  }
  if (config.isProd && config.jwt.secret.startsWith('dev-only')) {
    logger.warn('检测到开发用 JWT 密钥，生产环境请通过 JWT_SECRET / JWT_REFRESH_SECRET 注入随机值');
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();

  // 位于外部反向代理之后：按 X-Forwarded-* 识别真实客户端 IP（设计报告 10.5）
  app.set('trust proxy', config.trustProxy);
  app.setGlobalPrefix(config.apiPrefix);
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  if (config.corsOrigins.length > 0) {
    app.enableCors({ origin: config.corsOrigins, credentials: true });
  }

  if (config.swagger.enabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('ItemLife API')
        .setDescription('以物品为视角的个人 / 家庭记账服务（设计报告见 docs/design-report.html）')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    // 生产环境下配置了口令才开放文档，并加 Basic Auth 保护
    if (config.isProd && config.swagger.user && config.swagger.password) {
      app.use(['/api/docs', '/api/docs-json'], (req: Request, res: Response, next: NextFunction) => {
        const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
        if (scheme === 'Basic' && encoded) {
          const [user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
          if (user === config.swagger.user && pass === config.swagger.password) {
            next();
            return;
          }
        }
        res.setHeader('WWW-Authenticate', 'Basic realm="ItemLife Docs"');
        res.status(401).send('Authentication required');
      });
    }
    SwaggerModule.setup('api/docs', app, document);
    logger.log('Swagger 文档：/api/docs');
  }

  await app.listen(config.port, '0.0.0.0');
  logger.log(`API 已启动：http://0.0.0.0:${config.port}/${config.apiPrefix}（env=${config.nodeEnv}）`);
}

void bootstrap();
