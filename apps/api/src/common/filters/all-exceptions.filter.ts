import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

/** 统一错误响应：{ code, message, details? }；5xx 不向客户端泄露堆栈。 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let payload: ErrorPayload = { code: 'INTERNAL_ERROR', message: '服务器内部错误' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        payload = { code: httpStatusToCode(status), message: body };
      } else if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        const message = record.message;
        payload = {
          code: typeof record.code === 'string' ? record.code : httpStatusToCode(status),
          message: Array.isArray(message)
            ? message.join('；')
            : typeof message === 'string'
              ? message
              : '请求失败',
          details: record.details ?? (Array.isArray(message) ? message : undefined),
        };
      }
    } else {
      this.logger.error(
        `未捕获异常 ${request.method} ${request.originalUrl}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (status >= 500 && exception instanceof HttpException) {
      this.logger.error(`${status} ${request.method} ${request.originalUrl}`);
    }

    response.status(status).json(payload);
  }
}

function httpStatusToCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'TOO_MANY_REQUESTS';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
  }
}
