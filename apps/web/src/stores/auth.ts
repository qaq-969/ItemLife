import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { authApi, type AuthUser, type LoginPayload } from '@/api/auth';
import { ApiError } from '@/api/http';
import { useLedgerStore } from '@/stores/ledger';

export const useAuthStore = defineStore('auth', () => {
  // access token 只存内存，刷新令牌在 HttpOnly Cookie 中，避免 XSS 窃取
  const accessToken = ref<string | null>(null);
  const user = ref<AuthUser | null>(null);
  const pendingMfaTicket = ref<string | null>(null);
  const ready = ref(false);

  const isAuthenticated = computed(() => accessToken.value !== null && user.value !== null);
  const displayName = computed(() => user.value?.nickname || user.value?.email || '');

  function setSession(token: string, profile: AuthUser): void {
    accessToken.value = token;
    user.value = profile;
    pendingMfaTicket.value = null;
  }

  function setToken(token: string | null): void {
    accessToken.value = token;
    if (!token) user.value = null;
  }

  function clearSession(): void {
    accessToken.value = null;
    user.value = null;
    pendingMfaTicket.value = null;
    // 账本缓存与登录态同生命周期，避免下一个登录者看到上一位用户的账户与分类
    useLedgerStore().reset();
  }

  /** 启动时用刷新 Cookie 静默续期，恢复登录态 */
  async function bootstrap(): Promise<void> {
    try {
      const session = await authApi.refresh();
      setSession(session.accessToken, session.user);
    } catch {
      clearSession();
    } finally {
      ready.value = true;
    }
  }

  async function login(payload: LoginPayload): Promise<{ mfaRequired: boolean }> {
    const result = await authApi.login(payload);
    if (result.mfaRequired) {
      if (!result.mfaTicket) throw new ApiError('MFA_TICKET_MISSING', '服务端未返回 MFA 票据');
      pendingMfaTicket.value = result.mfaTicket;
      return { mfaRequired: true };
    }
    if (!result.accessToken || !result.user) {
      throw new ApiError('LOGIN_RESPONSE_INVALID', '登录响应缺少令牌，请重试');
    }
    setSession(result.accessToken, result.user);
    return { mfaRequired: false };
  }

  async function verifyMfa(code: string): Promise<void> {
    const ticket = pendingMfaTicket.value;
    if (!ticket) throw new ApiError('MFA_TICKET_MISSING', '两步验证票据已失效，请重新登录');
    const session = await authApi.verifyMfa({ mfaTicket: ticket, code });
    setSession(session.accessToken, session.user);
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout();
    } catch {
      // 登出接口失败（如网络异常 / 令牌已失效）也要清理本地登录态
    }
    clearSession();
  }

  return {
    accessToken,
    user,
    pendingMfaTicket,
    ready,
    isAuthenticated,
    displayName,
    setToken,
    setSession,
    clearSession,
    bootstrap,
    login,
    verifyMfa,
    logout,
  };
});
