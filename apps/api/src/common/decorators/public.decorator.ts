import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** 标记无需登录即可访问的端点（注册、登录、MFA 验证、健康检查等） */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
