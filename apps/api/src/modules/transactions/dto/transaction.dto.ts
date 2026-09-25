import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ALLOCATION_ROLES,
  TRANSACTION_TYPES,
  type AllocationRole,
  type TransactionType,
} from '@itemlife/shared';
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

/** 单批次数量上限：与物品侧 CreateAccessoryDto 保持一致。 */
const MAX_ACCESSORY_QTY = 10_000;

/** 记一笔记新物品时的内联小表单：购买日期取流水发生日期，金额取本行分摊金额。 */
export class InlineNewItemDto {
  @ApiPropertyOptional({ description: '临时键：供同一笔流水的其他行用 itemRef 引用（如本体行 + 配件行）' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  key?: string;

  @ApiProperty({ example: '电动牙刷' })
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: '预期寿命（天）' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36_500)
  expectedLifespanDays?: number;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** 记一笔时当场入库的配件批次：单价 = 本行分摊金额 ÷ 数量。 */
export class InlineAccessoryDto {
  @ApiPropertyOptional({ description: '配件名；省略取「配件」' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;

  @ApiProperty({ description: '本批次数量' })
  @IsInt()
  @Min(1)
  @Max(MAX_ACCESSORY_QTY)
  totalQty!: number;

  @ApiPropertyOptional({ description: '初始已用数量（≤ totalQty）；会同步写入一条使用审计' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ACCESSORY_QTY)
  usedQty?: number;

  @ApiPropertyOptional({ description: '购入日期 YYYY-MM-DD；省略取流水发生日期' })
  @IsOptional()
  @IsISO8601()
  purchasedAt?: string;
}

/** 分摊金额单位为分；null 仅在「单物品」时允许，表示继承整笔流水金额。 */
export class TransactionItemDto {
  @ApiPropertyOptional({ description: '本行临时键；供 parentKey 表达同一笔流水的任意层级' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  key?: string;

  @ApiPropertyOptional({ description: '父行临时键；省略即一级子账单' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  parentKey?: string;

  @ApiPropertyOptional({ description: '子账单名称；附加费用必填，编辑时也用于同步物品或配件名称' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: '已有物品 ID；与 itemRef / newItem 三选一' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ description: '已存在父子账单 ID；编辑已有流水时使用，新增推荐 parentKey' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ description: '引用本笔流水内 newItem 临时键创建的物品；三选一' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  itemRef?: string;

  @ApiPropertyOptional({ description: '当场新建物品；三选一' })
  @IsOptional()
  @ValidateNested()
  @Type(() => InlineNewItemDto)
  newItem?: InlineNewItemDto;

  @ApiPropertyOptional({ nullable: true, description: 'null = 继承整笔金额（仅单物品）' })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountMinor?: number | null;

  @ApiPropertyOptional({
    enum: ALLOCATION_ROLES,
    default: 'link',
    description: '用途：body 本体 / fee 附加费用 / accessory 配件 / link 仅关联；新建物品默认 body',
  })
  @IsOptional()
  @IsIn(ALLOCATION_ROLES)
  role?: AllocationRole;

  @ApiPropertyOptional({ description: 'role=accessory 时挑已有批次；与 newAccessory 二选一' })
  @IsOptional()
  @IsUUID()
  accessoryId?: string;

  @ApiPropertyOptional({ description: 'role=accessory 时当场新建批次（单价由金额 ÷ 数量反算）' })
  @IsOptional()
  @ValidateNested()
  @Type(() => InlineAccessoryDto)
  newAccessory?: InlineAccessoryDto;
}

export class CreateTransactionDto {
  @ApiProperty({
    enum: TRANSACTION_TYPES,
    description: '转账以 transfer_out 提交并附 toAccountId（服务端成对写入转出 + 转入）',
  })
  @IsIn(TRANSACTION_TYPES)
  type!: TransactionType;

  @ApiProperty({ description: '金额（分），始终为正数，方向由 type 表达' })
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiPropertyOptional({ description: '账户 ID；收支与转账（转出方）必填' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ description: '转入账户 ID；仅 transfer_out 需要' })
  @IsOptional()
  @IsUUID()
  toAccountId?: string;

  @ApiPropertyOptional({ description: '分类 ID；转账不可带分类' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: '发生时间（ISO 8601）；省略取当前时间' })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @ApiPropertyOptional({ type: [TransactionItemDto], description: '物品分摊；Σ分摊 ≤ 金额' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TransactionItemDto)
  items?: TransactionItemDto[];

  @ApiPropertyOptional({ description: '归属数据域；省略即个人' })
  @IsOptional()
  owner?: OwnerBodyDto;
}

export class UpdateTransactionDto {
  @ApiPropertyOptional({ description: '金额（分）；转账会同步两条腿' })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountMinor?: number;

  @ApiPropertyOptional({ description: '换账户；转账不支持改账户' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ nullable: true, description: '传 null 清空分类' })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string | null;

  @ApiPropertyOptional({ type: [TransactionItemDto], description: '整体替换分摊项；传 [] 清空' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TransactionItemDto)
  items?: TransactionItemDto[];
}

export class ListTransactionsQueryDto {
  @ApiPropertyOptional({ description: '数据域：user（默认）或 household:<id>' })
  @IsOptional()
  @IsString()
  domain?: string;

  @ApiPropertyOptional({ enum: TRANSACTION_TYPES })
  @IsOptional()
  @IsIn(TRANSACTION_TYPES)
  type?: TransactionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: '按分摊到的物品过滤（物品详情页的「关联流水」）' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ description: '起始日（含），YYYY-MM-DD' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: '结束日（含），YYYY-MM-DD' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: '备注模糊匹配' })
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

export class SummaryQueryDto {
  @ApiPropertyOptional({ description: '数据域：user（默认）或 household:<id>' })
  @IsOptional()
  @IsString()
  domain?: string;

  @ApiProperty({ description: '起始日（含），YYYY-MM-DD' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ description: '结束日（含），YYYY-MM-DD' })
  @IsISO8601()
  to!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;
}
