import { ApiProperty } from '@nestjs/swagger';
import type { Account } from '@prisma/client';
import { ACCOUNT_TYPES, INTEREST_FREQS, type AccountDto, type AccountType, type InterestFreq, type OwnerRef } from '@itemlife/shared';
import { toDateOnlyString } from '../../../common/utils/date';
import { bytesToUuid } from '../../../common/utils/id';

export class AccountVo implements AccountDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: { type: 'user', id: '0191…' } })
  owner!: OwnerRef;

  @ApiProperty({ example: '招商银行储蓄卡' })
  name!: string;

  @ApiProperty({ enum: ACCOUNT_TYPES })
  type!: AccountType;

  @ApiProperty({ example: 'CNY' })
  currency!: string;

  @ApiProperty({ description: '初始余额（分）' })
  initialBalanceMinor!: number;

  @ApiProperty({ description: '派生余额（分）：初始 + Σ收入 − Σ支出 + Σ转入 − Σ转出' })
  balanceMinor!: number;

  @ApiProperty({ nullable: true, description: '年化利率（基点）' })
  interestRateBp!: number | null;

  @ApiProperty({ nullable: true, enum: INTEREST_FREQS })
  interestFreq!: InterestFreq | null;

  @ApiProperty({ nullable: true, description: '上次结息日（YYYY-MM-DD），同时是自动结息的幂等标记' })
  interestPostedAt!: string | null;

  @ApiProperty()
  sortOrder!: number;

  static from(row: Account, balanceMinor: bigint): AccountVo {
    const vo = new AccountVo();
    vo.id = bytesToUuid(row.id);
    vo.owner = { type: row.ownerType, id: bytesToUuid(row.ownerId) };
    vo.name = row.name;
    vo.type = row.type as AccountType;
    vo.currency = row.currency;
    vo.initialBalanceMinor = Number(row.initialBalanceMinor);
    vo.balanceMinor = Number(balanceMinor);
    vo.interestRateBp = row.interestRateBp;
    vo.interestFreq = row.interestFreq as InterestFreq | null;
    vo.interestPostedAt = row.interestPostedAt ? toDateOnlyString(row.interestPostedAt) : null;
    vo.sortOrder = row.sortOrder;
    return vo;
  }
}
