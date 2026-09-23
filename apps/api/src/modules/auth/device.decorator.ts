import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface DeviceContext {
  ip: string | null;
  userAgent: string | null;
}

/** 提取设备信息（真实 IP 依赖 main.ts 的 trust proxy 配置），用于刷新令牌审计与在线设备列表 */
export const Device = createParamDecorator((_data: unknown, context: ExecutionContext): DeviceContext => {
  const request = context.switchToHttp().getRequest<Request>();
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
  };
});
