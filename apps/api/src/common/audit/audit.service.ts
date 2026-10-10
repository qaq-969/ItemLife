import { Injectable, Logger } from '@nestjs/common';

/**
 * 安全审计日志：结构化为单行 JSON，便于容器日志采集与检索。
 * 覆盖注册、登录成败、锁定、MFA 变更、令牌盗用等安全事件（设计报告 7.3）。
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  record(event: string, payload: Record<string, unknown> = {}): void {
    this.logger.log(JSON.stringify({ event, at: new Date().toISOString(), ...payload }));
  }
}
