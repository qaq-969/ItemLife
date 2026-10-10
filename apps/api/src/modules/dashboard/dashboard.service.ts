import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  DashboardBreakdownDto,
  DashboardComparisonDto,
  DashboardGranularity,
  DashboardOverviewDto,
  DashboardTrendDto,
  DashboardTrendPointDto,
} from '@itemlife/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OwnerScopeService, type OwnerScope } from '../../common/scope/owner-scope.service';
import { bytesToUuid, toIdBytes } from '../../common/utils/id';
import { AccountsService } from '../accounts/accounts.service';
import { ItemsService } from '../items/items.service';
import { signedAmountMinor } from '../transactions/balance.service';
import type { DashboardQueryDto } from './dto/dashboard.dto';

interface Range { from: Date; to: Date; toExclusive: Date; fromKey: string; toKey: string; }
interface Financials { expenseMinor: number; incomeMinor: number; savingMinor: number; returnMinor: number; }

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: OwnerScopeService,
    private readonly accounts: AccountsService,
    private readonly items: ItemsService,
  ) {}

  async overview(userId: string, query: DashboardQueryDto): Promise<DashboardOverviewDto> {
    const scope = await this.scopes.resolve(userId, query.domain);
    const range = this.range(query);
    const previous = this.previousRange(range);
    const [current, before, accountRows, itemInvestment] = await Promise.all([
      this.financials(scope, range, query.accountId),
      this.financials(scope, previous, query.accountId),
      this.accounts.listOf(scope),
      this.items.overview(userId, { domain: query.domain }),
    ]);
    const selectedAccounts = query.accountId ? accountRows.filter((row) => row.id === query.accountId) : accountRows;
    return {
      from: range.fromKey, to: range.toKey, ...current,
      netWorthMinor: selectedAccounts.reduce((sum, row) => sum + row.balanceMinor, 0),
      expenseComparison: compare(current.expenseMinor, before.expenseMinor),
      savingComparison: compare(current.savingMinor, before.savingMinor),
      itemInvestment: {
        payTotalMinor: itemInvestment.payTotalMinor,
        holdCostMinor: itemInvestment.holdCostMinor,
        remainingStockMinor: itemInvestment.remainingStockMinor,
        itemCount: itemInvestment.itemCount,
        inUseCount: itemInvestment.inUseCount,
      },
    };
  }

  async trend(userId: string, query: DashboardQueryDto): Promise<DashboardTrendDto> {
    const scope = await this.scopes.resolve(userId, query.domain);
    const range = this.range(query);
    const granularity = query.granularity ?? 'day';
    const accountId = query.accountId ? toIdBytes(query.accountId) : null;
    if (query.accountId && !accountId) throw new BadRequestException({ code: 'ACCOUNT_INVALID', message: '账户参数无效' });
    const [transactions, accounts] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          ...this.scopes.filter(scope), deletedAt: null, occurredAt: { lt: range.toExclusive },
          ...(accountId ? { accountId } : {}),
        },
        include: { category: true }, orderBy: { occurredAt: 'asc' },
      }),
      this.prisma.account.findMany({
        where: { ...this.scopes.filter(scope), deletedAt: null, ...(accountId ? { id: accountId } : {}) },
      }),
    ]);

    const buckets = this.buckets(range, granularity);
    const points = buckets.map((period): DashboardTrendPointDto => ({
      period, expenseMinor: 0, incomeMinor: 0, savingMinor: 0, returnMinor: 0, netWorthMinor: 0,
    }));
    const index = new Map(points.map((point, position) => [point.period, position]));

    for (const row of transactions) {
      if (row.occurredAt < range.from) continue;
      const position = index.get(bucketKey(row.occurredAt, range.from, granularity));
      if (position === undefined) continue;
      const point = points[position]!;
      if (row.type === 'expense') point.expenseMinor += Number(row.amountMinor);
      if (row.type === 'income') {
        point.incomeMinor += Number(row.amountMinor);
        if (isReturn(row)) point.returnMinor += Number(row.amountMinor);
      }
    }
    let runningNetWorth = accounts.reduce((sum, row) => sum + Number(row.initialBalanceMinor), 0);
    for (const row of transactions.filter((row) => row.occurredAt < range.from)) runningNetWorth += Number(signedAmountMinor(row.type, row.amountMinor));
    for (const point of points) {
      point.savingMinor = point.incomeMinor - point.expenseMinor;
      const rows = transactions.filter((row) => row.occurredAt >= range.from && bucketKey(row.occurredAt, range.from, granularity) === point.period);
      for (const row of rows) runningNetWorth += Number(signedAmountMinor(row.type, row.amountMinor));
      point.netWorthMinor = runningNetWorth;
    }
    return { from: range.fromKey, to: range.toKey, granularity, points };
  }

  async breakdown(userId: string, query: DashboardQueryDto): Promise<DashboardBreakdownDto> {
    const scope = await this.scopes.resolve(userId, query.domain);
    const range = this.range(query);
    const accountId = query.accountId ? toIdBytes(query.accountId) : null;
    const [rows, accounts] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { ...this.scopes.filter(scope), type: 'expense', deletedAt: null, occurredAt: { gte: range.from, lt: range.toExclusive }, ...(accountId ? { accountId } : {}) },
        include: { category: true },
      }),
      this.accounts.listOf(scope),
    ]);
    const total = rows.reduce((sum, row) => sum + Number(row.amountMinor), 0);
    const categories = new Map<string, { id: string | null; name: string; color: string | null; amountMinor: number }>();
    for (const row of rows) {
      const id = row.category ? bytesToUuid(row.category.id) : null;
      const key = id ?? 'none';
      const current = categories.get(key) ?? { id, name: row.category?.name ?? '未分类', color: row.category?.color ?? '#94a3b8', amountMinor: 0 };
      current.amountMinor += Number(row.amountMinor); categories.set(key, current);
    }
    const accountRows = query.accountId ? accounts.filter((row) => row.id === query.accountId) : accounts;
    const accountTotal = accountRows.reduce((sum, row) => sum + Math.abs(row.balanceMinor), 0);
    return {
      categories: [...categories.values()].sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 10)
        .map((row) => ({ ...row, percent: total === 0 ? 0 : Math.round(row.amountMinor * 10_000 / total) / 100 })),
      accounts: accountRows.map((row) => ({
        id: row.id, name: row.name, type: row.type, balanceMinor: row.balanceMinor,
        percent: accountTotal === 0 ? 0 : Math.round(Math.abs(row.balanceMinor) * 10_000 / accountTotal) / 100,
      })).sort((a, b) => Math.abs(b.balanceMinor) - Math.abs(a.balanceMinor)),
    };
  }

  private async financials(scope: OwnerScope, range: Range, accountId?: string): Promise<Financials> {
    const accountBytes = accountId ? toIdBytes(accountId) : null;
    const rows = await this.prisma.transaction.findMany({
      where: { ...this.scopes.filter(scope), deletedAt: null, occurredAt: { gte: range.from, lt: range.toExclusive }, ...(accountBytes ? { accountId: accountBytes } : {}) },
      include: { category: true },
    });
    let expenseMinor = 0; let incomeMinor = 0; let returnMinor = 0;
    for (const row of rows) {
      if (row.type === 'expense') expenseMinor += Number(row.amountMinor);
      if (row.type === 'income') { incomeMinor += Number(row.amountMinor); if (isReturn(row)) returnMinor += Number(row.amountMinor); }
    }
    return { expenseMinor, incomeMinor, savingMinor: incomeMinor - expenseMinor, returnMinor };
  }

  private range(query: DashboardQueryDto): Range {
    const now = new Date();
    const fromKey = query.from ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const toKey = query.to ?? isoDay(now);
    const from = new Date(`${fromKey}T00:00:00.000Z`);
    const to = new Date(`${toKey}T00:00:00.000Z`);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
      throw new BadRequestException({ code: 'DATE_RANGE_INVALID', message: '日期范围无效' });
    }
    return { from, to, toExclusive: addDays(to, 1), fromKey, toKey };
  }

  private previousRange(range: Range): Range {
    const days = Math.round((range.toExclusive.getTime() - range.from.getTime()) / 86_400_000);
    const toExclusive = range.from; const from = addDays(toExclusive, -days); const to = addDays(toExclusive, -1);
    return { from, to, toExclusive, fromKey: isoDay(from), toKey: isoDay(to) };
  }

  private buckets(range: Range, granularity: DashboardGranularity): string[] {
    const result: string[] = [];
    for (let cursor = range.from; cursor <= range.to;) {
      const key = bucketKey(cursor, range.from, granularity);
      if (result[result.length - 1] !== key) result.push(key);
      cursor = addDays(cursor, 1);
    }
    return result;
  }
}

function isReturn(row: { systemTag: string | null; category?: { systemTag: string | null } | null }): boolean {
  return row.systemTag === 'interest' || row.category?.systemTag === 'interest' || row.category?.systemTag === 'investment_return';
}
function compare(currentMinor: number, previousMinor: number): DashboardComparisonDto {
  return { currentMinor, previousMinor, changePercent: previousMinor === 0 ? null : Math.round((currentMinor - previousMinor) * 10_000 / Math.abs(previousMinor)) / 100 };
}
function addDays(date: Date, days: number): Date { return new Date(date.getTime() + days * 86_400_000); }
function isoDay(date: Date): string { return date.toISOString().slice(0, 10); }
function bucketKey(date: Date, origin: Date, granularity: DashboardGranularity): string {
  if (granularity === 'day') return isoDay(date);
  if (granularity === 'month') return isoDay(date).slice(0, 7);
  const days = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - origin.getTime()) / 86_400_000);
  return `第${Math.floor(days / 7) + 1}周`;
}
