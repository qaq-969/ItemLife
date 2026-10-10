/** 应用配置：从环境变量读取，集中默认值与类型。 */

export interface AppConfig {
  nodeEnv: string;
  isProd: boolean;
  port: number;
  apiPrefix: string;
  trustProxy: boolean | number;
  corsOrigins: string[];
  databaseUrl: string;
  redisUrl: string;
  jwt: {
    secret: string;
    refreshSecret: string;
    accessTtlSeconds: number;
    refreshTtlDays: number;
  };
  totpEncKey: string;
  swagger: {
    enabled: boolean;
    user: string;
    password: string;
  };
  throttle: {
    ttlSeconds: number;
    limit: number;
  };
}

function parseTrustProxy(raw: string | undefined): boolean | number {
  if (!raw) return false;
  const value = raw.trim().toLowerCase();
  if (value === 'false' || value === '0') return false;
  if (value === 'true') return true;
  const hops = Number(value);
  return Number.isInteger(hops) && hops > 0 ? hops : false;
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  const swaggerUser = process.env.SWAGGER_USER ?? '';
  const swaggerPassword = process.env.SWAGGER_PASSWORD ?? '';

  return {
    nodeEnv,
    isProd,
    port: Number(process.env.API_PORT ?? 3000),
    apiPrefix: 'api/v1',
    // 部署链路：客户端 → 外部反向代理 → web(nginx) → api，故默认信任 2 跳（详见设计报告 10.5）
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY ?? (isProd ? '2' : '0')),
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    databaseUrl: process.env.DATABASE_URL ?? '',
    redisUrl: process.env.REDIS_URL ?? '',
    jwt: {
      secret: process.env.JWT_SECRET ?? 'dev-only-jwt-secret-change-me',
      refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-only-refresh-secret-change-me',
      accessTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900),
      refreshTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 14),
    },
    totpEncKey: process.env.TOTP_ENC_KEY ?? '',
    swagger: {
      // 生产环境下必须显式提供口令才开放文档
      enabled: process.env.SWAGGER_ENABLED === '1' || (!isProd && process.env.SWAGGER_ENABLED !== '0') || (isProd && Boolean(swaggerUser && swaggerPassword)),
      user: swaggerUser,
      password: swaggerPassword,
    },
    throttle: {
      ttlSeconds: Number(process.env.THROTTLE_TTL_SECONDS ?? 60),
      limit: Number(process.env.THROTTLE_LIMIT ?? 120),
    },
  };
}
