import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginThrottleService } from './login-throttle.service';
import { MfaService } from './mfa.service';
import { TokenService } from './token.service';

/**
 * 认证模块（设计报告 7.2 / 7.3）：
 * 注册登录、TOTP 两步验证、恢复码、刷新令牌旋转与登录限流。
 * TokenService 对外导出，供全局 JwtAuthGuard 复用。
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService, MfaService, LoginThrottleService],
  exports: [TokenService],
})
export class AuthModule {}
