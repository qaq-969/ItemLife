import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { bytesToUuid } from '../../../common/utils/id';

export class AuthUserVo {
  @ApiProperty({ description: '用户 ID（UUID v7）' })
  id!: string;

  @ApiProperty({ example: 'dev@itemlife.local' })
  email!: string;

  @ApiProperty({ nullable: true, example: '小明' })
  nickname!: string | null;

  @ApiProperty({ description: '是否已开启两步验证' })
  mfaEnabled!: boolean;

  static from(user: User): AuthUserVo {
    const vo = new AuthUserVo();
    vo.id = bytesToUuid(user.id);
    vo.email = user.email;
    vo.nickname = user.nickname;
    vo.mfaEnabled = user.mfaEnabled;
    return vo;
  }
}

export class LoginResultVo {
  @ApiProperty({ description: '是否需要第二步 TOTP 验证' })
  mfaRequired!: boolean;

  @ApiPropertyOptional({ description: '两步验证票据（仅 mfaRequired=true 时返回，5 分钟有效）' })
  mfaTicket?: string;

  @ApiPropertyOptional({ description: '访问令牌（仅 mfaRequired=false 时返回，15 分钟有效）' })
  accessToken?: string;

  @ApiPropertyOptional({ type: AuthUserVo })
  user?: AuthUserVo;
}

export class AuthSessionVo {
  @ApiProperty({ description: '访问令牌：仅存前端内存，不落 localStorage' })
  accessToken!: string;

  @ApiProperty({ description: '访问令牌剩余有效秒数' })
  expiresIn!: number;

  @ApiProperty({ type: AuthUserVo })
  user!: AuthUserVo;
}

export class MfaSetupVo {
  @ApiProperty({ description: 'Base32 密钥（手工录入用）' })
  secret!: string;

  @ApiProperty({ description: 'otpauth:// 链接' })
  otpauthUrl!: string;

  @ApiProperty({ description: '二维码图片：data:image/png;base64,...' })
  qrDataUrl!: string;
}

export class MfaEnableVo {
  @ApiProperty({ description: '10 个一次性恢复码，仅此一次下发', type: [String] })
  recoveryCodes!: string[];
}
