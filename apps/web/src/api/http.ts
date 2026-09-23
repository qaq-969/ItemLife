import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { ApiEnvelope, ApiErrorBody } from '@itemlife/shared';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

/** 归一化后的接口错误：code 为业务错误码（如 UNAUTHORIZED / ITEM_NOT_FOUND）。 */
export class ApiError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

interface SessionHooks {
  getToken: () => string | null;
  setToken: (token: string | null) => void;
  onExpired: () => void;
}

let hooks: SessionHooks = {
  getToken: () => null,
  setToken: () => undefined,
  onExpired: () => undefined,
};

/** 由 auth store 注入令牌读写与过期回调，避免 api 层反向依赖状态层。 */
export function configureSession(next: SessionHooks): void {
  hooks = next;
}

export const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  // 刷新令牌走 HttpOnly Cookie，必须带凭据
  withCredentials: true,
});

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

http.interceptors.request.use((config) => {
  const token = hooks.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const NO_REFRESH_PATHS = [
  '/auth/token/refresh',
  '/auth/login',
  '/auth/register',
  '/auth/mfa/verify',
];

let refreshInFlight: Promise<string | null> | null = null;

/** 401 时静默续期一次（并发请求共用同一个刷新过程）。 */
function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= axios
    .post<ApiEnvelope<{ accessToken: string }>>(`${API_BASE_URL}/auth/token/refresh`, null, {
      withCredentials: true,
    })
    .then((response) => {
      const token = response.data.data.accessToken;
      hooks.setToken(token);
      return token;
    })
    .catch(() => null)
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const config = error.config as RetriableConfig | undefined;
    const status = error.response?.status;
    const url = config?.url ?? '';
    const skipRefresh = NO_REFRESH_PATHS.some((path) => url.includes(path));

    if (status === 401 && config && !config._retried && !skipRefresh) {
      config._retried = true;
      const token = await refreshAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        return http.request(config);
      }
      hooks.onExpired();
    }

    return Promise.reject(toApiError(error));
  },
);

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isAxiosError<ApiErrorBody>(error)) {
    const status = error.response?.status;
    const body = error.response?.data;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return new ApiError(body.code ?? 'REQUEST_FAILED', body.message, status, body.details);
    }
    if (!error.response) {
      return new ApiError('NETWORK_ERROR', '网络异常，请检查网络后重试');
    }
    return new ApiError('REQUEST_FAILED', error.message, status);
  }

  return new ApiError('UNKNOWN_ERROR', error instanceof Error ? error.message : '未知错误');
}

/** 解开 { code, message, data } 包络，业务代码直接拿到 data。 */
export async function unwrap<T>(request: Promise<{ data: ApiEnvelope<T> }>): Promise<T> {
  const response = await request;
  return response.data.data;
}
