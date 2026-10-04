/**
 * 认证链路离线冒烟：用内存假实现替换 Prisma / Redis，无需 MySQL 即可跑通
 * 注册 → 登录 → MFA 绑定 → 两段式登录 → 恢复码 → 刷新令牌旋转与盗用检测 → 登录锁定。
 *
 * 覆盖真实的路由 + 守卫 + 管道 + 服务 + Crypto/TOTP 实现，仅数据库与缓存被替换。
 * 运行：pnpm --filter @itemlife/api smoke:auth
 */
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { authenticator } from 'otplib';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/common/redis/redis.module';
import { REFRESH_TOKEN_REUSE_GRACE_MS } from '../src/modules/auth/token.service';
import { createInMemoryPrisma, createInMemoryRedis } from './support/in-memory';

const GLOBAL_TIMEOUT_MS = 240_000;
const TOTP_STEP_MS = 30_000;
const EMAIL = 'smoke@itemlife.local';
const PASSWORD = 'Smoke-Test-2026!';

interface JsonResponse {
  status: number;
  body: any;
  setCookie: string[];
}

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ` —— ${detail}`}`);
}

async function main(): Promise<void> {
  // 真实部署链路里 API 位于反向代理之后（设计报告 10.5）；此处按 1 跳配置，
  // 以便用 X-Forwarded-For 模拟不同客户端，避免冒烟请求相互触发限流。
  process.env.TRUST_PROXY = '1';

  const prisma = createInMemoryPrisma();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(REDIS_CLIENT)
    .useValue(createInMemoryRedis())
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>(undefined, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');

  const { port } = app.getHttpServer().address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/v1`;

  let ipCounter = 0;
  const nextIp = (): string => `10.0.1.${(ipCounter += 1) % 250}`;

  const request = async (
    method: string,
    path: string,
    options: { body?: unknown; token?: string; cookie?: string; ip?: string } = {},
  ): Promise<JsonResponse> => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': options.ip ?? nextIp(),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body, setCookie: response.headers.getSetCookie() };
  };

  const refreshCookie = (response: JsonResponse): string => {
    const cookie = response.setCookie.find((item) => item.startsWith('il_refresh_token='));
    return cookie ? cookie.split(';')[0]! : '';
  };

  // 防重放要求每次验证使用更新的时间步，这里统一保证「本次生成的码属于新的时间步」
  let lastTotpStepUsed = -1;
  const freshTotpCode = async (secret: string): Promise<string> => {
    const nowStep = Math.floor(Date.now() / TOTP_STEP_MS);
    if (nowStep <= lastTotpStepUsed) {
      const waitMs = (lastTotpStepUsed + 1) * TOTP_STEP_MS - Date.now() + 800;
      console.log(`  … 等待下一个 TOTP 时间步（${Math.ceil(waitMs / 1000)}s）`);
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 0)));
    }
    lastTotpStepUsed = Math.floor(Date.now() / TOTP_STEP_MS);
    return authenticator.generate(secret);
  };

  console.log('\n[1] 健康检查与认证边界');
  const health = await request('GET', '/health');
  check('GET /health 公开可访问且返回统一包络', health.status === 200 && health.body?.code === 0, JSON.stringify(health.body));

  const meAnonymous = await request('GET', '/auth/me');
  check('GET /auth/me 未登录返回 401', meAnonymous.status === 401 && meAnonymous.body?.code === 'UNAUTHORIZED', JSON.stringify(meAnonymous.body));

  console.log('\n[2] 注册');
  const weak = await request('POST', '/auth/register', { body: { email: EMAIL, password: 'short' } });
  check('弱密码被拒（400 PASSWORD_TOO_WEAK）', weak.status === 400 && weak.body?.code === 'PASSWORD_TOO_WEAK', JSON.stringify(weak.body));

  const registered = await request('POST', '/auth/register', { body: { email: EMAIL, password: PASSWORD, nickname: '冒烟用户' } });
  check('注册成功并返回用户资料', registered.status === 201 && registered.body?.data?.email === EMAIL, JSON.stringify(registered.body));
  check('响应中不含任何哈希字段', !JSON.stringify(registered.body).includes('argon2'), JSON.stringify(registered.body));

  const duplicated = await request('POST', '/auth/register', { body: { email: EMAIL, password: PASSWORD } });
  check('重复邮箱返回 409 EMAIL_TAKEN', duplicated.status === 409 && duplicated.body?.code === 'EMAIL_TAKEN', JSON.stringify(duplicated.body));

  console.log('\n[3] 登录第一步');
  const wrongPassword = await request('POST', '/auth/login', { body: { email: EMAIL, password: 'Wrong-Password-1!' } });
  check('密码错误返回 401 INVALID_CREDENTIALS', wrongPassword.status === 401 && wrongPassword.body?.code === 'INVALID_CREDENTIALS', JSON.stringify(wrongPassword.body));

  const unknownAccount = await request('POST', '/auth/login', { body: { email: 'nobody@itemlife.local', password: PASSWORD } });
  check('账号不存在返回相同的错误码（不暴露账号存在性）', unknownAccount.status === 401 && unknownAccount.body?.code === 'INVALID_CREDENTIALS', JSON.stringify(unknownAccount.body));

  const login = await request('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  check('登录成功返回 accessToken', login.status === 200 && login.body?.data?.mfaRequired === false && typeof login.body?.data?.accessToken === 'string', JSON.stringify(login.body));
  const cookie1 = refreshCookie(login);
  check('下发刷新 Cookie（HttpOnly + 仅 /api/v1/auth 可见）', cookie1.length > 0 && login.setCookie.some((item) => item.includes('HttpOnly') && item.includes('Path=/api/v1/auth')), JSON.stringify(login.setCookie));
  check('未启用 HTTPS 时不加 Secure（避免内网 HTTP 无法回传）', !login.setCookie.some((item) => item.includes('Secure')), JSON.stringify(login.setCookie));

  const token1 = login.body?.data?.accessToken as string;
  const me = await request('GET', '/auth/me', { token: token1 });
  check('携带 Bearer 可访问受保护端点', me.status === 200 && me.body?.data?.email === EMAIL, JSON.stringify(me.body));
  check('资料响应不含密码哈希与 TOTP 密钥', !/argon2|totpSecret|passwordHash/i.test(JSON.stringify(me.body)), JSON.stringify(me.body));

  console.log('\n[4] MFA 绑定');
  const setup = await request('POST', '/auth/mfa/setup', { token: token1 });
  const secret = setup.body?.data?.secret as string;
  check('setup 返回密钥与 otpauth 二维码', setup.status === 201 && typeof secret === 'string' && String(setup.body?.data?.qrDataUrl).startsWith('data:image/png;base64,'), JSON.stringify(setup.body?.code));
  check('setup 响应不含明文密钥之外的敏感字段', !JSON.stringify(setup.body).includes('userId'), JSON.stringify(setup.body?.data));

  const badEnable = await request('POST', '/auth/mfa/enable', { token: token1, body: { code: '000000' } });
  check('错误动态码无法开启 MFA', badEnable.status === 400 && badEnable.body?.code === 'MFA_CODE_INVALID', JSON.stringify(badEnable.body));

  const enable = await request('POST', '/auth/mfa/enable', { token: token1, body: { code: await freshTotpCode(secret) } });
  const recoveryCodes = (enable.body?.data?.recoveryCodes ?? []) as string[];
  check('开启成功并一次性下发 10 个恢复码', enable.status === 201 && recoveryCodes.length === 10, JSON.stringify(enable.body?.data));
  check('恢复码为随机值且互不相同', new Set(recoveryCodes).size === 10 && recoveryCodes.every((code) => /^[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(code)), JSON.stringify(recoveryCodes));

  console.log('\n[5] 两段式登录');
  const loginMfa = await request('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  check('已开 MFA 时只返回票据，不下发令牌', loginMfa.status === 200 && loginMfa.body?.data?.mfaRequired === true && typeof loginMfa.body?.data?.mfaTicket === 'string' && !loginMfa.body?.data?.accessToken, JSON.stringify(loginMfa.body?.data));
  check('第一步不写刷新 Cookie', refreshCookie(loginMfa) === '', JSON.stringify(loginMfa.setCookie));
  const ticket = loginMfa.body?.data?.mfaTicket as string;

  const badCode = await request('POST', '/auth/mfa/verify', { body: { mfaTicket: ticket, code: '123456' } });
  check('错误动态码被拒（401 INVALID_MFA_CODE）', badCode.status === 401 && badCode.body?.code === 'INVALID_MFA_CODE', JSON.stringify(badCode.body));

  const code = await freshTotpCode(secret);
  const verified = await request('POST', '/auth/mfa/verify', { body: { mfaTicket: ticket, code } });
  check('正确动态码签发正式会话', verified.status === 200 && typeof verified.body?.data?.accessToken === 'string', JSON.stringify(verified.body));
  const cookie2 = refreshCookie(verified);
  const token2 = verified.body?.data?.accessToken as string;
  check('第二步下发刷新 Cookie', cookie2.length > 0, JSON.stringify(verified.setCookie));

  const replay = await request('POST', '/auth/mfa/verify', { body: { mfaTicket: ticket, code } });
  check('同一时间步动态码重放被拒（防重放）', replay.status === 401 && replay.body?.code === 'INVALID_MFA_CODE', JSON.stringify(replay.body));

  console.log('\n[6] 恢复码');
  const loginAgain = await request('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  const recoveryLogin = await request('POST', '/auth/mfa/verify', {
    body: { mfaTicket: loginAgain.body?.data?.mfaTicket, code: recoveryCodes[0] },
  });
  check('恢复码可完成登录', recoveryLogin.status === 200 && typeof recoveryLogin.body?.data?.accessToken === 'string', JSON.stringify(recoveryLogin.body));

  const loginThird = await request('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  const reuseRecovery = await request('POST', '/auth/mfa/verify', {
    body: { mfaTicket: loginThird.body?.data?.mfaTicket, code: recoveryCodes[0] },
  });
  check('已用恢复码不可重复使用', reuseRecovery.status === 401, JSON.stringify(reuseRecovery.body));

  console.log('\n[7] 刷新令牌旋转与盗用检测');
  const rotated = await request('POST', '/auth/token/refresh', { cookie: cookie2 });
  const cookie3 = refreshCookie(rotated);
  check('刷新成功返回新的访问令牌', rotated.status === 200 && typeof rotated.body?.data?.accessToken === 'string', JSON.stringify(rotated.body));
  check('刷新令牌已轮换（Cookie 值变化）', cookie3.length > 0 && cookie3 !== cookie2, `old=${cookie2.slice(0, 20)}… new=${cookie3.slice(0, 20)}…`);

  const rotatedToken = rotated.body?.data?.accessToken as string;
  const meAfterRefresh = await request('GET', '/auth/me', { token: rotatedToken });
  check('刷新后新令牌可用', meAfterRefresh.status === 200, JSON.stringify(meAfterRefresh.body));

  const reused = await request('POST', '/auth/token/refresh', { cookie: cookie2 });
  check('并发刷新宽限期内旧令牌返回可重试状态', reused.status === 401 && reused.body?.code === 'REFRESH_TOKEN_STALE', JSON.stringify(reused.body));

  const afterRace = await request('POST', '/auth/token/refresh', { cookie: cookie3 });
  const cookie4 = refreshCookie(afterRace);
  check('并发刷新不会吊销已经签发的新会话', afterRace.status === 200 && cookie4.length > 0, JSON.stringify(afterRace.body));

  const oldHash = createHash('sha256').update(cookie2.split('=')[1] ?? '').digest('hex');
  const oldRecord = prisma.$tables.refreshToken.rows.find((row: any) => row.tokenHash === oldHash);
  if (oldRecord) oldRecord.revokedAt = new Date(Date.now() - REFRESH_TOKEN_REUSE_GRACE_MS - 1_000);
  const replayedLater = await request('POST', '/auth/token/refresh', { cookie: cookie2 });
  check('宽限期后旧刷新令牌复用仍触发盗用响应', replayedLater.status === 401 && replayedLater.body?.code === 'REFRESH_TOKEN_REUSED', JSON.stringify(replayedLater.body));

  const afterTheft = await request('POST', '/auth/token/refresh', { cookie: cookie4 });
  check('整族吊销后派生令牌同样失效', afterTheft.status === 401, JSON.stringify(afterTheft.body));

  console.log('\n[8] 登录失败锁定');
  const blockedIp = '10.9.9.9';
  const blockedEmail = 'blocked@itemlife.local';
  await request('POST', '/auth/register', { body: { email: blockedEmail, password: PASSWORD }, ip: blockedIp });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await request('POST', '/auth/login', { body: { email: blockedEmail, password: 'Wrong-Password-1!' }, ip: blockedIp });
  }
  const locked = await request('POST', '/auth/login', { body: { email: blockedEmail, password: PASSWORD }, ip: blockedIp });
  check('连续 5 次失败后返回 429 ACCOUNT_LOCKED（即使密码正确）', locked.status === 429 && locked.body?.code === 'ACCOUNT_LOCKED', JSON.stringify(locked.body));
  check('锁定响应给出重试等待秒数', typeof locked.body?.details?.retryAfterSeconds === 'number', JSON.stringify(locked.body?.details));

  const otherIp = '10.9.9.10';
  const notLockedElsewhere = await request('POST', '/auth/login', { body: { email: blockedEmail, password: PASSWORD }, ip: otherIp });
  check('锁定按「账号 + IP」隔离，其他 IP 不受影响', notLockedElsewhere.status === 200, JSON.stringify(notLockedElsewhere.body));

  console.log('\n[9] 登出');
  const freshLogin = await request('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  const session = await request('POST', '/auth/mfa/verify', {
    body: { mfaTicket: freshLogin.body?.data?.mfaTicket, code: await freshTotpCode(secret) },
  });
  const sessionToken = session.body?.data?.accessToken as string;
  const sessionCookie = refreshCookie(session);
  check('重新登录成功', typeof sessionToken === 'string' && sessionCookie.length > 0, JSON.stringify(session.body?.data));

  const logout = await request('POST', '/auth/logout', { token: sessionToken });
  check('登出成功并清除 Cookie', logout.status === 200 && logout.setCookie.some((item) => item.includes('il_refresh_token=;')), JSON.stringify(logout.setCookie));

  const afterLogout = await request('POST', '/auth/token/refresh', { cookie: sessionCookie });
  check('登出后刷新令牌立即失效', afterLogout.status === 401 && afterLogout.body?.code === 'REFRESH_TOKEN_INVALID', JSON.stringify(afterLogout.body));

  await app.close();

  const failed = results.filter((item) => !item.ok);
  console.log(`\n=== 冒烟结果：${results.length - failed.length}/${results.length} 通过 ===`);
  if (failed.length > 0) {
    console.log(failed.map((item) => `  ✗ ${item.name} —— ${item.detail ?? ''}`).join('\n'));
    process.exitCode = 1;
  }
}

setTimeout(() => {
  console.error(`冒烟脚本超时（${GLOBAL_TIMEOUT_MS} ms）`);
  process.exit(1);
}, GLOBAL_TIMEOUT_MS).unref();

void main().catch((error) => {
  console.error('冒烟脚本异常：', error);
  process.exit(1);
});
