import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn } from 'class-validator';

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
