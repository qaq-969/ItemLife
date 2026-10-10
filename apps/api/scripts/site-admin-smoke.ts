/**
 * 站点管理离线冒烟：首位超级管理员、注册开关、单次邀请码、角色边界与账号停用。
 * 运行：pnpm --filter @itemlife/api smoke:site-admin
 */
import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/common/redis/redis.module';
import { createInMemoryPrisma, createInMemoryRedis } from './support/in-memory';

const PASSWORD = 'Site-Admin-2026!';
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ` —— ${detail}`}`);
}

async function main(): Promise<void> {
  process.env.TRUST_PROXY = '1';
  const prisma = createInMemoryPrisma();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService).useValue(prisma)
    .overrideProvider(REDIS_CLIENT).useValue(createInMemoryRedis())
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>(undefined, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');

  const { port } = app.getHttpServer().address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/v1`;
  let ip = 10;
  const request = async (
    method: string,
    path: string,
    options: { body?: unknown; token?: string; cookie?: string } = {},
  ): Promise<{ status: number; body: any; cookies: string[] }> => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `10.5.0.${ip++}`,
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body, cookies: response.headers.getSetCookie() };
  };
  const register = (email: string, inviteCode?: string) =>
    request('POST', '/auth/register', { body: { email, password: PASSWORD, inviteCode } });
  const login = (email: string, password = PASSWORD) => request('POST', '/auth/login', { body: { email, password } });
  const tokenOf = (response: { body: any }): string => response.body?.data?.accessToken ?? '';
  const cookieOf = (response: { cookies: string[] }): string =>
    response.cookies.find((value) => value.startsWith('il_refresh_token='))?.split(';')[0] ?? '';

  console.log('\n[1] 初始化与首位超级管理员');
  const initial = await request('GET', '/site/status');
  check('未初始化站点默认开放注册', initial.status === 200 && initial.body?.data?.registrationOpen === true && initial.body?.data?.initialized === false, JSON.stringify(initial.body));
  const first = await register('owner@itemlife.local');
  check('首个注册账号成为超级管理员', first.status === 201 && first.body?.data?.siteRole === 'super_admin', JSON.stringify(first.body));
  const second = await register('admin@itemlife.local');
  check('后续账号默认为普通用户', second.status === 201 && second.body?.data?.siteRole === 'user', JSON.stringify(second.body));
  const ownerLogin = await login('owner@itemlife.local');
  const ownerToken = tokenOf(ownerLogin);
  check('超级管理员可登录', ownerLogin.status === 200 && ownerToken.length > 0, JSON.stringify(ownerLogin.body));

  console.log('\n[2] 关闭注册与单次邀请码');
  const closed = await request('PATCH', '/site/admin/registration', { token: ownerToken, body: { registrationOpen: false } });
  check('超级管理员可关闭公开注册', closed.status === 200 && closed.body?.data?.registrationOpen === false, JSON.stringify(closed.body));
  const denied = await register('denied@itemlife.local');
  check('关闭后无邀请码注册被拒', denied.status === 403 && denied.body?.code === 'SITE_INVITE_INVALID', JSON.stringify(denied.body));
  const created = await request('POST', '/site/admin/invites', { token: ownerToken, body: { remark: '牙刷群用户' } });
  const inviteCode = created.body?.data?.code as string;
  check('管理员生成带备注的 8 位邀请码', created.status === 201 && /^[2-9A-HJ-NP-Z]{8}$/.test(inviteCode) && created.body?.data?.remark === '牙刷群用户', JSON.stringify(created.body));
  const invited = await register('member@itemlife.local', inviteCode);
  check('有效邀请码可注册一次', invited.status === 201 && invited.body?.data?.siteRole === 'user', JSON.stringify(invited.body));
  const reused = await register('reused@itemlife.local', inviteCode);
  check('同一邀请码不可复用', reused.status === 403 && reused.body?.code === 'SITE_INVITE_INVALID', JSON.stringify(reused.body));

  console.log('\n[3] 管理员权限边界');
  const overview = await request('GET', '/site/admin', { token: ownerToken });
  const adminUser = overview.body?.data?.users?.find((user: any) => user.email === 'admin@itemlife.local');
  const memberUser = overview.body?.data?.users?.find((user: any) => user.email === 'member@itemlife.local');
  check('管理页列出站点用户', overview.status === 200 && adminUser && memberUser, JSON.stringify(overview.body));
  check('邀请码备注仅随管理页用户信息返回', memberUser?.inviteRemark === '牙刷群用户', JSON.stringify(memberUser));
  const promoted = await request('PATCH', `/site/admin/users/${adminUser?.id}/role`, { token: ownerToken, body: { role: 'admin' } });
  check('超级管理员可授予管理员权限', promoted.status === 200 && promoted.body?.data?.siteRole === 'admin', JSON.stringify(promoted.body));
  const adminLogin = await login('admin@itemlife.local');
  const adminToken = tokenOf(adminLogin);
  const adminInvite = await request('POST', '/site/admin/invites', { token: adminToken, body: {} });
  check('管理员可在关闭注册时生成邀请码', adminInvite.status === 201 && typeof adminInvite.body?.data?.code === 'string', JSON.stringify(adminInvite.body));
  const forbiddenToggle = await request('PATCH', '/site/admin/registration', { token: adminToken, body: { registrationOpen: true } });
  check('普通管理员不能修改注册开关', forbiddenToggle.status === 403 && forbiddenToggle.body?.code === 'SUPER_ADMIN_REQUIRED', JSON.stringify(forbiddenToggle.body));
  const forbiddenRole = await request('PATCH', `/site/admin/users/${memberUser?.id}/role`, { token: adminToken, body: { role: 'admin' } });
  check('普通管理员不能授予管理员权限', forbiddenRole.status === 403 && forbiddenRole.body?.code === 'SUPER_ADMIN_REQUIRED', JSON.stringify(forbiddenRole.body));

  console.log('\n[4] 停用即时失效与恢复');
  const memberLogin = await login('member@itemlife.local');
  const memberToken = tokenOf(memberLogin);
  const memberCookie = cookieOf(memberLogin);
  const disabled = await request('PATCH', `/site/admin/users/${memberUser?.id}/status`, { token: adminToken, body: { enabled: false } });
  check('管理员可停用普通用户', disabled.status === 200 && typeof disabled.body?.data?.disabledAt === 'string', JSON.stringify(disabled.body));
  const oldAccess = await request('GET', '/auth/me', { token: memberToken });
  check('停用后现有访问令牌立即失效', oldAccess.status === 401, JSON.stringify(oldAccess.body));
  const oldRefresh = await request('POST', '/auth/token/refresh', { cookie: memberCookie });
  check('停用后刷新令牌失效', oldRefresh.status === 401, JSON.stringify(oldRefresh.body));
  const disabledLogin = await login('member@itemlife.local');
  check('停用用户无法登录且不暴露停用状态', disabledLogin.status === 401 && disabledLogin.body?.code === 'INVALID_CREDENTIALS', JSON.stringify(disabledLogin.body));
  const restored = await request('PATCH', `/site/admin/users/${memberUser?.id}/status`, { token: adminToken, body: { enabled: true } });
  check('管理员可恢复普通用户', restored.status === 200 && restored.body?.data?.disabledAt === null, JSON.stringify(restored.body));
  const restoredLogin = await login('member@itemlife.local');
  check('恢复后可重新登录', restoredLogin.status === 200 && tokenOf(restoredLogin).length > 0, JSON.stringify(restoredLogin.body));

  console.log('\n[5] 超级管理员重置密码与永久删除');
  const resetPassword = 'Reset-Member-2026!';
  const forbiddenReset = await request('PATCH', `/site/admin/users/${memberUser?.id}/password`, { token: adminToken, body: { password: resetPassword } });
  check('普通管理员不能重置用户密码', forbiddenReset.status === 403 && forbiddenReset.body?.code === 'SUPER_ADMIN_REQUIRED', JSON.stringify(forbiddenReset.body));
  const weakReset = await request('PATCH', `/site/admin/users/${memberUser?.id}/password`, { token: ownerToken, body: { password: 'weak' } });
  check('重置密码仍执行统一强度规则', weakReset.status === 400 && weakReset.body?.code === 'PASSWORD_TOO_WEAK', JSON.stringify(weakReset.body));
  const reset = await request('PATCH', `/site/admin/users/${memberUser?.id}/password`, { token: ownerToken, body: { password: resetPassword } });
  check('超级管理员可重置其他用户密码', reset.status === 200, JSON.stringify(reset.body));
  const resetOldAccess = await request('GET', '/auth/me', { token: tokenOf(restoredLogin) });
  check('重置后现有访问令牌立即失效', resetOldAccess.status === 401, JSON.stringify(resetOldAccess.body));
  const oldPasswordLogin = await login('member@itemlife.local');
  check('重置后旧密码失效', oldPasswordLogin.status === 401, JSON.stringify(oldPasswordLogin.body));
  const resetLogin = await login('member@itemlife.local', resetPassword);
  check('重置后新密码可登录', resetLogin.status === 200, JSON.stringify(resetLogin.body));
  const forbiddenDelete = await request('DELETE', `/site/admin/users/${memberUser?.id}`, { token: adminToken });
  check('普通管理员不能永久删除用户', forbiddenDelete.status === 403 && forbiddenDelete.body?.code === 'SUPER_ADMIN_REQUIRED', JSON.stringify(forbiddenDelete.body));
  const deleted = await request('DELETE', `/site/admin/users/${memberUser?.id}`, { token: ownerToken });
  check('超级管理员可永久删除其他用户', deleted.status === 200, JSON.stringify(deleted.body));
  const deletedLogin = await login('member@itemlife.local', resetPassword);
  check('永久删除后用户无法登录', deletedLogin.status === 401, JSON.stringify(deletedLogin.body));
  const afterDelete = await request('GET', '/site/admin', { token: ownerToken });
  check('永久删除后用户不再出现在管理页', !afterDelete.body?.data?.users?.some((user: any) => user.email === 'member@itemlife.local'), JSON.stringify(afterDelete.body));

  console.log('\n[6] 重新开放注册');
  const opened = await request('PATCH', '/site/admin/registration', { token: ownerToken, body: { registrationOpen: true } });
  check('超级管理员可重新开放注册', opened.status === 200 && opened.body?.data?.registrationOpen === true, JSON.stringify(opened.body));
  const needlessInvite = await request('POST', '/site/admin/invites', { token: ownerToken, body: {} });
  check('公开注册时不生成邀请码', needlessInvite.status === 409 && needlessInvite.body?.code === 'REGISTRATION_IS_OPEN', JSON.stringify(needlessInvite.body));
  const publicUser = await register('public@itemlife.local');
  check('开放后无需邀请码即可注册', publicUser.status === 201, JSON.stringify(publicUser.body));

  await app.close();
  const failed = results.filter((result) => !result.ok);
  console.log(`\n=== 站点管理冒烟：${results.length - failed.length}/${results.length} 通过 ===`);
  if (failed.length) process.exitCode = 1;
}

setTimeout(() => { console.error('站点管理冒烟超时'); process.exit(1); }, 120_000).unref();
void main().catch((error) => { console.error('站点管理冒烟异常：', error); process.exit(1); });
