import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

/** 全局密码学工具：认证、邀请码、备份等模块共用 */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
