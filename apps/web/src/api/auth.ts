import { http, unwrap } from './http';
import type { SiteRole } from '@itemlife/shared';

export interface AuthUser {
  id: string;
  email: string;
  nickname: string | null;
  mfaEnabled: boolean;
  siteRole: SiteRole;
}

export interface RegisterPayload {
  email: string;
  password: string;
  nickname?: string;
  inviteCode?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

/** 登录第一步结果：已开 MFA 时只返回短期票据，需再走 /auth/mfa/verify。 */
export interface LoginResult {
  mfaRequired: boolean;
  mfaTicket?: string;
  accessToken?: string;
  user?: AuthUser;
}

export interface AuthSession {
  accessToken: string;
  user: AuthUser;
}

export interface MfaSetupResult {
  secret: string;
  otpauthUrl: string;
  /** data:image/png;base64,... 形式的二维码 */
  qrDataUrl: string;
}

export interface MfaEnableResult {
  recoveryCodes: string[];
}

export const authApi = {
  register: (payload: RegisterPayload) => unwrap<AuthUser>(http.post('/auth/register', payload)),
  login: (payload: LoginPayload) => unwrap<LoginResult>(http.post('/auth/login', payload)),
  verifyMfa: (payload: { mfaTicket: string; code: string }) =>
    unwrap<AuthSession>(http.post('/auth/mfa/verify', payload)),
  refresh: () => unwrap<AuthSession>(http.post('/auth/token/refresh', null)),
  me: () => unwrap<AuthUser>(http.get('/auth/me')),
  updateProfile: (nickname: string) => unwrap<AuthUser>(http.patch('/auth/me', { nickname })),
  logout: () => unwrap<null>(http.post('/auth/logout', null)),
  logoutAll: () => unwrap<null>(http.post('/auth/logout-all', null)),
  mfaSetup: () => unwrap<MfaSetupResult>(http.post('/auth/mfa/setup', null)),
  mfaEnable: (code: string) => unwrap<MfaEnableResult>(http.post('/auth/mfa/enable', { code })),
  mfaDisable: (payload: { password: string; code: string }) =>
    unwrap<null>(http.post('/auth/mfa/disable', payload)),
};
