import { ApiPropertyOptional } from '@nestjs/swagger';
import { OWNER_TYPES, type OwnerType } from '@itemlife/shared';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

/** 请求体里的数据域声明：与 `?domain=` 等价，省略即个人域（见 OwnerScopeService）。 */
export class OwnerBodyDto {
  @ApiPropertyOptional({ enum: OWNER_TYPES, default: 'user', description: '数据归属：个人或家庭' })
  @IsOptional()
  @IsIn(OWNER_TYPES)
  type?: OwnerType;

  @ApiPropertyOptional({ description: 'type=household 时必填；非成员或不存在一律 404' })
  @IsOptional()
  @IsUUID()
  id?: string;
}
