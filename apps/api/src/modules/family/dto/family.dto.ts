import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateHouseholdDto {
  @ApiProperty({ example: '我们家' })
  @IsString()
  @Length(1, 50)
  name!: string;
}

export class UpdateHouseholdDto {
  @ApiProperty({ example: '新的家庭名称' })
  @IsString()
  @Length(1, 50)
  name!: string;
}

export class DeleteHouseholdDto {
  @ApiProperty({ description: '必须与当前家庭名称完全一致' })
  @IsString()
  @Length(1, 50)
  confirmationName!: string;
}

export class UpdateHouseholdMemberRoleDto {
  @ApiProperty({ enum: ['admin', 'member'] })
  @IsIn(['admin', 'member'])
  role!: 'admin' | 'member';
}

export class CreateInviteDto {
  @ApiPropertyOptional({ default: 72, description: '有效小时数' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  expiresInHours?: number;

  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxUses?: number;
}

export class JoinHouseholdDto {
  @ApiProperty({ example: '7K9P3XQW' })
  @IsString()
  @Length(8, 8)
  code!: string;
}
