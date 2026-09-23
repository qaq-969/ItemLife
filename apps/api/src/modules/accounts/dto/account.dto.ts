import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ACCOUNT_TYPES, INTEREST_FREQS, type AccountType, type InterestFreq } from '@itemlife/shared';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { OwnerBodyDto } from '../../../common/dto/owner-body.dto';

/** 年化基点上限 10000bp = 100%；0 视为不计息。 */
const MAX_RATE_BP = 10_000;

export class CreateAccountDto {
  @ApiProperty({ example: '招商银行储蓄卡' })
  @IsString()
  @Length(1, 50)
  name!: string;

  @ApiProperty({ enum: ACCOUNT_TYPES })
  @IsIn(ACCOUNT_TYPES)
  type!: AccountType;

  @ApiPropertyOptional({ description: '初始余额（分），可为负（如应付）' })
  @IsOptional()
  @IsInt()
  initialBalanceMinor?: number;

  @ApiPropertyOptional({ description: '年化利率（基点，1bp=0.01%）；与 interestFreq 成对出现' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RATE_BP)
  interestRateBp?: number;

  @ApiPropertyOptional({ enum: INTEREST_FREQS })
  @IsOptional()
  @IsIn(INTEREST_FREQS)
  interestFreq?: InterestFreq;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ description: '归属数据域；省略即个人' })
  @IsOptional()
  owner?: OwnerBodyDto;
}

export class UpdateAccountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 50)
  name?: string;

  @ApiPropertyOptional({ enum: ACCOUNT_TYPES })
  @IsOptional()
  @IsIn(ACCOUNT_TYPES)
  type?: AccountType;

  @ApiPropertyOptional({ nullable: true, description: '传 null 关闭计息（同时清空周期）' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RATE_BP)
  interestRateBp?: number | null;

  @ApiPropertyOptional({ nullable: true, enum: INTEREST_FREQS })
  @IsOptional()
  @IsIn(INTEREST_FREQS)
  interestFreq?: InterestFreq | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ListAccountsQueryDto {
  @ApiPropertyOptional({ description: '数据域：user（默认）或 household:<id>' })
  @IsOptional()
  @IsString()
  domain?: string;
}
