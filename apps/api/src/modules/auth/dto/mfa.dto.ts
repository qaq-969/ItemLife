import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class MfaVerifyDto {
  @ApiProperty({ description: '登录第一步返回的 mfaTicket' })
  @IsString()
  @MaxLength(1024)
  mfaTicket!: string;

  @ApiProperty({ description: '6 位动态码或一枚恢复码' })
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code!: string;
}

export class MfaEnableDto {
  @ApiProperty({ description: '身份验证器中的 6 位动态码' })
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code!: string;
}

export class MfaDisableDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  password!: string;

  @ApiProperty({ description: '6 位动态码或一枚恢复码' })
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code!: string;
}
