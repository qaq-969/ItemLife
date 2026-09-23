import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '@itemlife/shared';

export class RegisterDto {
  @ApiProperty({ example: 'dev@itemlife.local' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @MaxLength(255)
  email!: string;

  // 强度细则由 checkPasswordStrength 统一裁决（返回 PASSWORD_TOO_WEAK 及具体缺项），此处只挡住超长输入
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, description: '≥10 位且含大小写字母、数字与符号' })
  @IsString()
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nickname?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'dev@itemlife.local' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @MaxLength(255)
  email!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  password!: string;
}
