import type { Request } from 'express';

/** 通过 JWT 守卫后挂在 request 上的当前登录者（不含邮箱等隐私字段） */
export interface AuthenticatedUser {
  id: string;
  /** 会话标识（JWT 的 sid），与 refresh_tokens 中的当前会话对应 */
  sessionId: string;
  /** 该会话是否已完成两步验证；未完成 MFA 的会话不得访问业务端点 */
  mfa: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
