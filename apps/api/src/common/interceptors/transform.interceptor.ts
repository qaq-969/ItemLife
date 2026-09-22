import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

/** 统一响应包络：{ code: 0, message: 'ok', data }；错误统一由 AllExceptionsFilter 输出。 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T>> {
    return next.handle().pipe(map((data) => ({ code: 0, message: 'ok', data })));
  }
}
