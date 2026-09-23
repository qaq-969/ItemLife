import { ApiProperty } from '@nestjs/swagger';
import type { InterestRunResult } from '@itemlife/shared';

export class InterestRunResultVo implements InterestRunResult {
  @ApiProperty()
  accountId!: string;

  @ApiProperty()
  accountName!: string;

  @ApiProperty({ description: '计息区间首日（含），YYYY-MM-DD' })
  from!: string;

  @ApiProperty({ description: '计息区间末日（含），YYYY-MM-DD' })
  to!: string;

  @ApiProperty()
  days!: number;

  @ApiProperty({ description: '区间日均余额（分）' })
  averageBalanceMinor!: number;

  @ApiProperty({ description: '本期利息（分）：Σ(每日余额 × 年化 ÷ 365)' })
  interestMinor!: number;

  @ApiProperty({ description: '计息周期是否已满：未满只能预览，自动结息不会落账' })
  due!: boolean;

  @ApiProperty({ description: '下一个满周期日，YYYY-MM-DD' })
  nextDueAt!: string;

  @ApiProperty({ description: 'true 表示只算不入账' })
  preview!: boolean;

  @ApiProperty({ nullable: true, description: '入账生成的收入流水 ID；利息不足 1 分时为 null' })
  transactionId!: string | null;
}
