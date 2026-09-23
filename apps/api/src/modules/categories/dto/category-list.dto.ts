import { ApiPropertyOptional } from '@nestjs/swagger';
import { CATEGORY_KINDS, type CategoryKind } from '@itemlife/shared';
import { Transform } from 'class-transformer';
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
  // 查询参数是字符串，隐式转换会先跑且 Boolean('false') === true，
  // 因此必须回读原始入参显式解析，否则 includeArchived=false 会被当成 true
  @Transform(({ obj, key }) => {
    const raw = (obj as Record<string, unknown>)[key];
    if (raw === undefined || raw === null || raw === '') return undefined;
    return raw === true || raw === 'true' || raw === '1';
  })
  @IsBoolean()
  includeArchived?: boolean;
}
