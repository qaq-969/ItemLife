import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSiteInviteDto {
  @ApiProperty({ required: false, maxLength: 100, description: '仅站点管理员可见的邀请备注' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  remark?: string;
}

export class UpdateRegistrationDto {
  @ApiProperty()
  @IsBoolean()
  registrationOpen!: boolean;
}

export class UpdateSiteRoleDto {
  @ApiProperty({ enum: ['admin', 'user'] })
  @IsIn(['admin', 'user'])
  role!: 'admin' | 'user';
}

export class UpdateSiteUserStatusDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}
