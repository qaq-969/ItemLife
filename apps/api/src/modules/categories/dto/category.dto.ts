import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CATEGORY_KINDS, type CategoryKind } from '@itemlife/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { OwnerBodyDto } from '../../../common/dto/owner-body.dto';

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export class CreateCategoryDto {
  @ApiProperty({ enum: CATEGORY_KINDS, description: '收支两套分类树相互独立' })
  @IsIn(CATEGORY_KINDS)
  kind!: CategoryKind;

  @ApiProperty({ example: '外卖' })
  @IsString()
  @Length(1, 30)
  name!: string;

  @ApiPropertyOptional({ description: '父分类 ID；仅支持两级，父分类必须为顶层' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ example: 'bike' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  icon?: string;

  @ApiPropertyOptional({ example: '#f97316' })
  @IsOptional()
  @Matches(COLOR_PATTERN, { message: '颜色需为 #RRGGBB 格式' })
  color?: string;

  @ApiPropertyOptional({ description: '同层排序，小的在前' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @ApiPropertyOptional({ description: '归属数据域；省略即个人' })
  @IsOptional()
  owner?: OwnerBodyDto;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 30)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 50)
  icon?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(COLOR_PATTERN, { message: '颜色需为 #RRGGBB 格式' })
  color?: string;

  @ApiPropertyOptional({ description: '传 null 可取消父分类（提升为顶层）' })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @ApiPropertyOptional({ description: '停用 / 恢复：停用后不再出现在记账选择器中，历史流水不受影响' })
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class ReorderCategoryItemDto {
  @ApiProperty()
  @IsUUID()
  id!: string;

  @ApiProperty({ description: '同层排序，小的在前' })
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder!: number;

  @ApiPropertyOptional({ nullable: true, description: '拖动跨组时的新父分类；null = 提升为顶层' })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

/** 移动端拖拽后的批量落库：一次请求完成同级排序 + 跨组移动。 */
export class ReorderCategoriesDto {
  @ApiProperty({ type: [ReorderCategoryItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReorderCategoryItemDto)
  items!: ReorderCategoryItemDto[];

  @ApiPropertyOptional({ description: '归属数据域；省略即个人' })
  @IsOptional()
  owner?: OwnerBodyDto;
}
