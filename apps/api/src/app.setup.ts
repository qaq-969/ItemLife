import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { loadConfig, type AppConfig } from './config/configuration';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { patchBigIntJson } from './common/utils/bigint-json';

/**
 * 运行时装配：main.ts 与离线冒烟脚本（scripts/auth-smoke.ts）共用，
 * 保证「按配置装配」的路径只有一条，测试覆盖的就是线上启用的那套管道。
 */
export function configureApp(app: NestExpressApplication, config: AppConfig = loadConfig()): void {
  patchBigIntJson();
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

  setupSwagger(app, config);
}

function setupSwagger(app: NestExpressApplication, config: AppConfig): void {
  if (!config.swagger.enabled) return;

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
  new Logger('Bootstrap').log('Swagger 文档：/api/docs');
}
