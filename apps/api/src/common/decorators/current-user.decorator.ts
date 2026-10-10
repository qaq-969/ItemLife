import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedRequest, AuthenticatedUser } from '../types/auth-user';

/** 取当前登录者；仅可用于受 JwtAuthGuard 保护的端点 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedUser => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.user) {
    throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: '登录状态已失效，请重新登录' });
  }
  return request.user;
});
