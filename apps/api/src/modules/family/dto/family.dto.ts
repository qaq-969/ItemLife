import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateHouseholdDto {
  @ApiProperty({ example: '我们家' })
  @IsString()
  @Length(1, 50)
  name!: string;
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
