import { Injectable } from '@nestjs/common';
import type { OwnerType, Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { addDaysUtc, dayKey, daysBetweenUtc, startOfDayUtc } from '../../common/utils/date';
import { bytesToUuid, type IdBytes } from '../../common/utils/id';

/** 只依赖 transaction 委托：PrismaService 与事务客户端都能满足。 */
export type TransactionClient = Pick<Prisma.TransactionClient, 'transaction'>;

/** 余额方向：收入 / 转入记正，支出 / 转出记负（设计报告 5.2 ②）。 */
export function signedAmountMinor(type: TransactionType | string, amountMinor: bigint): bigint {
  return type === 'income' || type === 'transfer_in' ? amountMinor : -amountMinor;
}

export interface DailyBalance {
  from: Date;
  to: Date;
  /** 区间天数（含首尾） */
  days: number;
  openingMinor: bigint;
  closingMinor: bigint;
  /** 每日日终余额之和：结息口径 Σ(每日余额 × 年化 ÷ 365) 的分子部分 */
  dailySumMinor: bigint;
  averageMinor: bigint;
}

/**
 * 余额一律派生计算，不冗余存储（设计报告 5.2 ②）：
 * 余额 = 初始余额 + Σ收入 − Σ支出 + Σ转入 − Σ转出，软删除的流水不计入。
 */
@Injectable()
export class BalanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** 批量派生余额：一次分组聚合覆盖整页账户，避免 N+1。 */
  async balances(
    scope: { ownerType: OwnerType; ownerId: IdBytes },
    accounts: Array<{ id: IdBytes; initialBalanceMinor: bigint }>,
    client: TransactionClient = this.prisma,
  ): Promise<Map<string, bigint>> {
    const result = new Map<string, bigint>();
    if (accounts.length === 0) return result;
    for (const account of accounts) result.set(bytesToUuid(account.id), account.initialBalanceMinor);

    const grouped = await client.transaction.groupBy({
      by: ['accountId', 'type'],
      where: {
        ownerType: scope.ownerType,
        ownerId: scope.ownerId,
        deletedAt: null,
        accountId: { in: accounts.map((account) => account.id) },
      },
      _sum: { amountMinor: true },
    });

    for (const row of grouped) {
      const key = bytesToUuid(row.accountId);
      const current = result.get(key);
      if (current === undefined) continue;
      result.set(key, current + signedAmountMinor(row.type, row._sum?.amountMinor ?? 0n));
    }
    return result;
  }

  async balanceOf(
    scope: { ownerType: OwnerType; ownerId: IdBytes },
    account: { id: IdBytes; initialBalanceMinor: bigint },
    client: TransactionClient = this.prisma,
  ): Promise<bigint> {
    const map = await this.balances(scope, [account], client);
    return map.get(bytesToUuid(account.id)) ?? 0n;
  }

  /** 区间每日余额（日终口径）与均值：结息与「持有成本」都基于它。 */
  async dailyBalances(
    account: { id: IdBytes; initialBalanceMinor: bigint },
    from: Date,
    to: Date,
    client: TransactionClient = this.prisma,
  ): Promise<DailyBalance> {
    const start = startOfDayUtc(from);
    const end = startOfDayUtc(to);
    const days = daysBetweenUtc(start, end) + 1;
    if (days <= 0) {
      return { from: start, to: end, days: 0, openingMinor: 0n, closingMinor: 0n, dailySumMinor: 0n, averageMinor: 0n };
    }

    const rows = await client.transaction.findMany({
      where: { accountId: account.id, deletedAt: null, occurredAt: { lt: addDaysUtc(end, 1) } },
      select: { type: true, amountMinor: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    });

    const fromKey = dayKey(start);
    const perDay = new Map<string, bigint>();
    let opening = account.initialBalanceMinor;
    for (const row of rows) {
      const key = dayKey(row.occurredAt);
      if (key < fromKey) {
        opening += signedAmountMinor(row.type, row.amountMinor);
        continue;
      }
      perDay.set(key, (perDay.get(key) ?? 0n) + signedAmountMinor(row.type, row.amountMinor));
    }

    let balance = opening;
    let dailySum = 0n;
    for (let index = 0; index < days; index += 1) {
      balance += perDay.get(dayKey(addDaysUtc(start, index))) ?? 0n;
      dailySum += balance;
    }

    return {
      from: start,
      to: end,
      days,
      openingMinor: opening,
      closingMinor: balance,
      dailySumMinor: dailySum,
      averageMinor: dailySum / BigInt(days),
    };
  }
}
