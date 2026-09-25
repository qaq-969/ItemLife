import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ITEM_STATUSES, type ItemStatus } from '@itemlife/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OwnerBodyDto } from '../../../common/dto/owner-body.dto';

/** 单批次数量上限：家庭场景足够用，同时挡住误输入的巨大值把成本指标算爆。 */
const MAX_QTY = 10_000;

export class CreateAccessoryDto {
  @ApiProperty({ example: '替换刷头' })
  @IsString()
  @Length(1, 60)
  name!: string;

  @ApiProperty({ description: '单价（分）' })
  @IsInt()
  @Min(0)
  unitPriceMinor!: number;

  @ApiProperty({ description: '本批次数量' })
  @IsInt()
  @Min(1)
  @Max(MAX_QTY)
  totalQty!: number;

  @ApiPropertyOptional({ description: '购入日期 YYYY-MM-DD；省略取物品购买日（新增批次时取今天）' })
  @IsOptional()
  @IsISO8601()
  purchasedAt?: string;

  @ApiPropertyOptional({ description: '初始已用数量（≤ totalQty）；会同步写入一条使用审计' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_QTY)
  usedQty?: number;

  @ApiPropertyOptional({ description: '关联的购买流水（可选，对账用；成本指标不读流水）' })
  @IsOptional()
  @IsUUID()
  transactionId?: string;
}

export class CreateItemDto {
  @ApiProperty({ example: '电动牙刷' })
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ description: '购买日 YYYY-MM-DD' })
  @IsISO8601()
  purchaseDate!: string;

  @ApiProperty({ description: '本体价（分）' })
  @IsInt()
  @Min(0)
  purchasePriceMinor!: number;

  @ApiPropertyOptional({ description: '预期寿命（天）：填了才有「预计日均成本」' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36_500)
  expectedLifespanDays?: number;

  @ApiPropertyOptional({ enum: ITEM_STATUSES, default: 'in_use' })
  @IsOptional()
  @IsIn(ITEM_STATUSES)
  status?: ItemStatus;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @ApiPropertyOptional({ type: [CreateAccessoryDto], description: '随物品一并入库的配件批次' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreateAccessoryDto)
  accessories?: CreateAccessoryDto[];

  @ApiPropertyOptional({ description: '归属数据域；省略即个人' })
  @IsOptional()
  owner?: OwnerBodyDto;
}

export class UpdateItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional({ nullable: true, description: '传 null 移出分类' })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({ description: '购买日 YYYY-MM-DD' })
  @IsOptional()
  @IsISO8601()
  purchaseDate?: string;

  @ApiPropertyOptional({ description: '本体价（分）' })
  @IsOptional()
  @IsInt()
  @Min(0)
  purchasePriceMinor?: number;

  @ApiPropertyOptional({ nullable: true, description: '传 null 清空预期寿命' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36_500)
  expectedLifespanDays?: number | null;

  @ApiPropertyOptional({ enum: ITEM_STATUSES })
  @IsOptional()
  @IsIn(ITEM_STATUSES)
  status?: ItemStatus;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string | null;
}

export class ListItemsQueryDto {
  @ApiPropertyOptional({ description: '数据域：user（默认）或 household:<id>' })
  @IsOptional()
  @IsString()
  domain?: string;

  @ApiPropertyOptional({ enum: ITEM_STATUSES })
  @IsOptional()
  @IsIn(ITEM_STATUSES)
  status?: ItemStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: '名称模糊匹配' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  keyword?: string;

  @ApiPropertyOptional({ description: '上一页返回的 nextCursor' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

/** 消耗 / 撤销共用的入参：省略 qty 即操作 1 个。 */
export class AccessoryQtyDto {
  @ApiPropertyOptional({ default: 1, description: '本次消耗 / 撤销的数量' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_QTY)
  qty?: number;
}

/** 撤销库存会保留原始采购和流水，只新增一条凭据。 */
export class InventoryRevertDto {
  @ApiPropertyOptional({ enum: ['dispose', 'correction'], default: 'dispose' })
  @IsOptional()
  @IsIn(['dispose', 'correction'])
  kind?: 'dispose' | 'correction';

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @Length(1, 200)
  reason!: string;

  @ApiPropertyOptional({ description: '配件撤销数量；省略时撤销全部可用库存' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_QTY)
  qty?: number;
}
