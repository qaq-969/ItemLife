import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedRequest } from '../types/auth-user';
import { TokenService } from '../../modules/auth/token.service';

/**
 * 全局登录守卫：默认所有端点都要求 Authorization: Bearer <access_token>，
 * 公开端点用 @Public() 显式放行。未完成 MFA 的会话（无 mfa 声明）同样拒绝。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest & Request>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: '请先登录' });
    }

    const payload = await this.tokenService.verifyAccessToken(token);
    if (!payload.mfa) {
      throw new UnauthorizedException({ code: 'MFA_NOT_COMPLETED', message: '该会话尚未完成两步验证' });
    }

    request.user = { id: payload.sub, sessionId: payload.sid, mfa: payload.mfa };
    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
