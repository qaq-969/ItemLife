import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TRANSACTION_TYPES, type TransactionType } from '@itemlife/shared';
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
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OwnerBodyDto } from '../../../common/dto/owner-body.dto';

/** 分摊金额单位为分；null 仅在「单物品」时允许，表示继承整笔流水金额。 */
export class TransactionItemDto {
  @ApiProperty()
  @IsUUID()
  itemId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'null = 继承整笔金额（仅单物品）' })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountMinor?: number | null;
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
