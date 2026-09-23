import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Account } from '@prisma/client';
import type {
  AccountSummaryDto,
  AccountType,
  InterestFreq,
} from '@itemlife/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OwnerScopeService, type OwnerScope } from '../../common/scope/owner-scope.service';
import { bytesToUuid, newId, toIdBytes, type IdBytes } from '../../common/utils/id';
import { BalanceService } from '../transactions/balance.service';
import type { CreateAccountDto, ListAccountsQueryDto, UpdateAccountDto } from './dto/account.dto';
import { AccountVo } from './dto/account.vo';

export function accountNotFound(): NotFoundException {
  return new NotFoundException({ code: 'ACCOUNT_NOT_FOUND', message: '账户不存在或无权访问' });
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: OwnerScopeService,
    private readonly balance: BalanceService,
  ) {}

  async list(userId: string, query: ListAccountsQueryDto): Promise<AccountVo[]> {
    const scope = await this.scopes.resolve(userId, query.domain);
    return this.listOf(scope);
  }

  /** 数据域内全部账户 + 派生余额（供流水模块与结息模块复用）。 */
  async listOf(scope: OwnerScope): Promise<AccountVo[]> {
    const rows = await this.prisma.account.findMany({
      where: { ...this.scopes.filter(scope), deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const balances = await this.balance.balances(scope, rows);
    return rows.map((row) => AccountVo.from(row, balances.get(bytesToUuid(row.id)) ?? row.initialBalanceMinor));
  }

  async summary(userId: string, query: ListAccountsQueryDto): Promise<AccountSummaryDto> {
    const accounts = await this.list(userId, query);
    const byType = new Map<AccountType, { totalMinor: number; count: number }>();
    let totalMinor = 0;

    for (const account of accounts) {
      totalMinor += account.balanceMinor;
      const bucket = byType.get(account.type) ?? { totalMinor: 0, count: 0 };
      bucket.totalMinor += account.balanceMinor;
      bucket.count += 1;
      byType.set(account.type, bucket);
    }

    return {
      totalMinor,
      byType: [...byType.entries()].map(([type, bucket]) => ({ type, ...bucket })),
    };
  }

  async create(userId: string, dto: CreateAccountDto): Promise<AccountVo> {
    const scope = await this.scopes.resolveFromBody(userId, dto.owner);
    const name = dto.name.trim();
    await this.assertNameFree(scope, name, null);
    const interest = normalizeInterest(dto.interestRateBp, dto.interestFreq);

    const row = await this.prisma.account.create({
      data: {
        id: newId(),
        ...this.scopes.filter(scope),
        name,
        type: dto.type,
        initialBalanceMinor: BigInt(dto.initialBalanceMinor ?? 0),
        interestRateBp: interest.interestRateBp,
        interestFreq: interest.interestFreq,
        sortOrder: dto.sortOrder ?? (await this.nextSortOrder(scope)),
      },
    });
    return AccountVo.from(row, row.initialBalanceMinor);
  }

  async update(userId: string, id: string, dto: UpdateAccountDto): Promise<AccountVo> {
    const { row, scope } = await this.requireScoped(userId, id);
    const name = dto.name?.trim();
    if (name && name !== row.name) await this.assertNameFree(scope, name, row.id);

    const interest = normalizeInterest(
      dto.interestRateBp === undefined ? (row.interestRateBp ?? undefined) : dto.interestRateBp,
      dto.interestFreq === undefined ? ((row.interestFreq as InterestFreq | null) ?? undefined) : dto.interestFreq,
    );

    const updated = await this.prisma.account.update({
      where: { id: row.id },
      data: {
        ...(name ? { name } : {}),
        ...(dto.type ? { type: dto.type } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        interestRateBp: interest.interestRateBp,
        interestFreq: interest.interestFreq,
      },
    });
    const balance = await this.balance.balanceOf(scope, updated);
    return AccountVo.from(updated, balance);
  }

  /** 删除：有流水引用时只能保留（余额需可追溯），返回 409 引导用户先处理流水。 */
  async remove(userId: string, id: string): Promise<null> {
    const { row, scope } = await this.requireScoped(userId, id);
    const used = await this.prisma.transaction.count({
      where: { ...this.scopes.filter(scope), accountId: row.id, deletedAt: null },
    });
    if (used > 0) {
      throw new ConflictException({
        code: 'ACCOUNT_IN_USE',
        message: `该账户下还有 ${used} 笔流水，删除会导致余额无法追溯；请先删除或迁移这些流水`,
      });
    }

    await this.prisma.account.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    return null;
  }

  /** 按 id 定位账户，同时反查其数据域并校验权限（越权与不存在同为 404）。结息模块复用。 */
  async requireScoped(userId: string, id: string): Promise<{ row: Account; scope: OwnerScope }> {
    const bytes = toIdBytes(id);
    const row = bytes ? await this.prisma.account.findFirst({ where: { id: bytes, deletedAt: null } }) : null;
    if (!row) throw accountNotFound();
    return { row, scope: await this.scopes.resolveOwned(userId, row.ownerType, row.ownerId, accountNotFound) };
  }

  private async assertNameFree(scope: OwnerScope, name: string, excludeId: IdBytes | null): Promise<void> {
    const existing = await this.prisma.account.findFirst({
      where: { ...this.scopes.filter(scope), name, deletedAt: null },
      select: { id: true },
    });
    if (existing && (!excludeId || bytesToUuid(existing.id) !== bytesToUuid(excludeId))) {
      throw new ConflictException({ code: 'ACCOUNT_NAME_TAKEN', message: '已有同名账户' });
    }
  }

  private async nextSortOrder(scope: OwnerScope): Promise<number> {
    const last = await this.prisma.account.findFirst({
      where: { ...this.scopes.filter(scope), deletedAt: null },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return last ? last.sortOrder + 1 : 0;
  }
}

/** 利率与周期必须成对出现：两者都给才计息，任一显式传 null 则整体关闭计息。 */
function normalizeInterest(
  rateBp: number | null | undefined,
  freq: InterestFreq | null | undefined,
): { interestRateBp: number | null; interestFreq: InterestFreq | null } {
  if (rateBp === null || freq === null) return { interestRateBp: null, interestFreq: null };

  const hasRate = rateBp !== undefined;
  const hasFreq = freq !== undefined;
  if (hasRate !== hasFreq) {
    throw new BadRequestException({
      code: 'INTEREST_CONFIG_INCOMPLETE',
      message: '年化利率与结息周期必须同时提供或同时留空',
    });
  }
  return hasRate
    ? { interestRateBp: rateBp, interestFreq: freq as InterestFreq }
    : { interestRateBp: null, interestFreq: null };
}
