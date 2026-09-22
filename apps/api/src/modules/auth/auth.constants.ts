/** Auth 模块常量：TTL、Redis 键与登录失败锁定策略（设计报告 7.3） */

/** 登录第一步签发的 MFA 短期票据有效期：5 分钟，且不含任何业务权限 */
export const MFA_TICKET_TTL_SECONDS = 300;
/** 绑定中的 TOTP 密钥在服务端的暂存时长（内存态，不落库） */
export const MFA_SETUP_TTL_SECONDS = 600;
/** TOTP 时间步长与容差窗口：±1 步（±30s）容忍设备时钟漂移 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_WINDOW = 1;
export const TOTP_ISSUER = 'ItemLife';

export const REDIS_KEYS = {
  /** 绑定中（未确认）的 TOTP 密钥 */
  mfaSetup: (userId: string) => `auth:mfa:setup:${userId}`,
  /** TOTP 最后成功时间步的缓存副本（DB 为准，Redis 加速比对） */
  totpStep: (userId: string) => `auth:mfa:step:${userId}`,
  /** 登录失败计数 */
  loginFail: (scope: string) => `auth:fail:${scope}`,
  /** 锁定标记 */
  loginLock: (scope: string) => `auth:lock:${scope}`,
  /** 锁定等级（用于指数退避） */
  lockLevel: (scope: string) => `auth:lvl:${scope}`,
} as const;

export const LOGIN_FAILURE_POLICY = {
  /** 统计窗口：15 分钟 */
  windowSeconds: 900,
  /** 窗口内失败达到该次数即锁定 */
  threshold: 5,
  /** 指数退避：1min → 5min → 15min */
  lockSecondsByLevel: [60, 300, 900],
  /** 锁定等级记忆时长：24 小时 */
  levelTtlSeconds: 86_400,
} as const;
