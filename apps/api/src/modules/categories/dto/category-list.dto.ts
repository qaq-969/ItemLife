import { ApiPropertyOptional } from '@nestjs/swagger';
import { CATEGORY_KINDS, type CategoryKind } from '@itemlife/shared';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class ListCategoriesQueryDto {
  @ApiPropertyOptional({ enum: CATEGORY_KINDS, description: '省略则返回收支两棵树' })
  @IsOptional()
  @IsIn(CATEGORY_KINDS)
  kind?: CategoryKind;

  @ApiPropertyOptional({ description: '数据域：user（默认）或 household:<id>' })
  @IsOptional()
  @IsString()
  domain?: string;

  @ApiPropertyOptional({ description: '是否含已停用分类，默认 false' })
  @IsOptional()
  @IsBoolean()
  includeArchived?: boolean;
}
