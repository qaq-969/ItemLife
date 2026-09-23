import type { CookieOptions, Request } from 'express';

/**
 * 刷新令牌 Cookie 策略（设计报告 7.3）：
 * HttpOnly + SameSite=Lax，且仅对 /api/v1/auth 路径可见，避免随业务请求无谓携带。
 * Secure 动态判定：由外层反向代理终止 TLS 时，X-Forwarded-Proto=https 即视为安全链路。
 */
export function refreshCookieOptions(request: Request, maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: maxAgeMs,
  };
}

export function clearRefreshCookieOptions(request: Request): CookieOptions {
  return {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: 'lax',
    path: '/api/v1/auth',
  };
}

function isSecureRequest(request: Request): boolean {
  if (request.secure) return true;
  const forwardedProto = request.headers['x-forwarded-proto'];
  const value = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  return value?.split(',')[0]?.trim() === 'https';
}
