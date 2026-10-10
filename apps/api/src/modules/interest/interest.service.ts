import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Account } from '@prisma/client';
import {
  DEFAULT_CURRENCY,
  INTEREST_FREQ_MONTHS,
  SYSTEM_TAGS,
  interestFromDailySum,
  type InterestFreq,
  type InterestRunResult,
} from '@itemlife/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ownerScopeOf, OwnerScopeService, type OwnerScope } from '../../common/scope/owner-scope.service';
import { addDaysUtc, addMonthsUtc, startOfDayUtc, toDateOnlyString } from '../../common/utils/date';
import { bytesToUuid, newId, type IdBytes } from '../../common/utils/id';
import { AccountsService } from '../accounts/accounts.service';
import { CategoriesService } from '../categories/categories.service';
import { BalanceService } from '../transactions/balance.service';
import type { InterestPreviewQueryDto } from './dto/interest.dto';
import { InterestRunResultVo } from './dto/interest.vo';

/** 计息区间（含首尾）。 */
interface Period {
  from: Date;
  to: Date;
  due: boolean;
  nextDueAt: Date;
}

@Injectable()
export class InterestService {
  private readonly logger = new Logger(InterestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: OwnerScopeService,
    private readonly accounts: AccountsService,
    private readonly categories: CategoriesService,
    private readonly balance: BalanceService,
    private readonly audit: AuditService,
  ) {}

  /** 每日 02:30（UTC，与 DATE 列口径一致）扫描到期账户自动结息。 */
  @Cron('0 30 2 * * *')
  async handleDailySettlement(): Promise<void> {
    const posted = await this.runDue();
    if (posted.length > 0) {
      this.logger.log(`自动结息完成：${posted.length} 个账户，合计 ${posted.reduce((sum, row) => sum + row.interestMinor, 0)} 分`);
    }
  }

  /** 预估：只算不入账，返回区间 [上次结息日+1, 今天] 的应计利息。 */
  async preview(userId: string, query: InterestPreviewQueryDto): Promise<InterestRunResult[]> {
    const scope = await this.scopes.resolve(userId, query.domain);
    const accounts = query.accountId
      ? [await this.requireInterestAccount(userId, query.accountId)]
      : await this.accruingAccounts(scope);

    const results: InterestRunResult[] = [];
    for (const account of accounts) {
      const period = this.periodOf(account, new Date());
      if (period.from > period.to) continue; // 刚结过息，本期尚未开始
      results.push(await this.evaluate(scope, account, period, true));
    }
    return results;
  }

  /** 手动结息：区间 [上次结息日+1, 今天]，即使未满整周期也可结（续期从今天重新起算）。 */
  async post(userId: string, accountId: string): Promise<InterestRunResult> {
    const account = await this.requireInterestAccount(userId, accountId);
    const scope = ownerScopeOf(account.ownerType, account.ownerId);
    const period = this.periodOf(account, new Date());

    if (period.from > period.to) {
      throw new BadRequestException({
        code: 'INTEREST_PERIOD_EMPTY',
        message: `上次结息日为 ${toDateOnlyString(addDaysUtc(period.from, -1))}，今天尚未产生新的计息天数`,
      });
    }

    const { result, posted } = await this.settle(scope, account, period, 'manual');
    if (!posted) {
      throw new BadRequestException({
        code: 'INTEREST_ALREADY_POSTED',
        message: '该账户本期已结息（或正在被其它请求处理），请刷新后查看',
      });
    }
    return result;
  }

  /** 扫描全部到期账户并结息（自动任务与手动「立即结息全部」共用）。 */
  async runDue(now = new Date()): Promise<InterestRunResult[]> {
    const accounts = await this.prisma.account.findMany({
      where: { deletedAt: null, interestRateBp: { not: null }, interestFreq: { not: null } },
    });

    const settled: InterestRunResult[] = [];
    for (const account of accounts) {
      const period = this.periodOf(account, now);
      if (!period.due) continue;

      try {
        const { result, posted } = await this.settle(
          ownerScopeOf(account.ownerType, account.ownerId),
          account,
          period,
          'auto',
        );
        if (posted) settled.push(result);
      } catch (error) {
        // 单个账户失败不影响其它账户；幂等标记决定下次重跑是否补结
        this.logger.error(`账户 ${bytesToUuid(account.id)} 自动结息失败：${(error as Error).message}`);
      }
    }
    return settled;
  }

  /**
   * 区间与到期判定：锚点 = 上次结息日（从未结息则取账户创建日）。
   *
   * 区间终点一律取「今天」：设计报告 8.5 的「按日计息 · 按实际天数计息」要求
   * 利息不因结息延迟而漏算，服务停机几天后重跑也能补上这几天的利息。
   * `due` 只决定自动任务是否触发（today ≥ 锚点 + 周期），周期本身不影响天数口径。
   */
  private periodOf(account: Account, now: Date): Period {
    const anchor = startOfDayUtc(account.interestPostedAt ?? account.createdAt);
    const today = startOfDayUtc(now);
    const months = INTEREST_FREQ_MONTHS[account.interestFreq as InterestFreq];
    const nextDueAt = addMonthsUtc(anchor, months);

    return {
      // 锚点当天已结清，新的计息从次日开始，保证区间首尾相接且不重复计息
      from: addDaysUtc(anchor, 1),
      to: today,
      due: today >= nextDueAt,
      nextDueAt,
    };
  }

  private async evaluate(
    scope: OwnerScope,
    account: Account,
    period: Period,
    preview: boolean,
  ): Promise<InterestRunResult> {
    const { interestMinor, averageMinor } = await this.accrual(account, period);
    return this.toResult(account, period, {
      interestMinor,
      averageMinor,
      preview,
      transactionId: null,
    });
  }

  /**
   * 落账：先用 interest_posted_at 的乐观更新抢占本期（updateMany 带原值条件），
   * 抢不到的进程直接放弃 —— 这是「重跑不重复入账」的幂等保证（设计报告 8.5）。
   */
  private async settle(
    scope: OwnerScope,
    account: Account,
    period: Period,
    reason: 'auto' | 'manual',
  ): Promise<{ result: InterestRunResult; posted: boolean }> {
    const { interestMinor, averageMinor } = await this.accrual(account, period);

    const actorId = await this.systemActorId(account);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.account.updateMany({
        where: { id: account.id, interestPostedAt: account.interestPostedAt },
        data: { interestPostedAt: period.to },
      });
      if (claimed.count === 0) return { claimed: false, transactionId: null };

      // 不足 1 分不入账（避免垃圾流水），但标记已推进，本期不再重复计算
      if (interestMinor <= 0) return { claimed: true, transactionId: null };

      const categoryId = await this.categories.ensureSystemCategory(tx, scope, SYSTEM_TAGS.interest, {
        name: '利息收益',
        icon: 'percent',
        color: '#059669',
      });
      const id = newId();
      await tx.transaction.create({
        data: {
          id,
          ...this.scopes.filter(scope),
          type: 'income',
          amountMinor: BigInt(interestMinor),
          currency: account.currency || DEFAULT_CURRENCY,
          accountId: account.id,
          categoryId,
          occurredAt: period.to,
          note: `结息 ${toDateOnlyString(period.from)} ~ ${toDateOnlyString(period.to)}`,
          systemTag: SYSTEM_TAGS.interest,
          createdBy: actorId,
        },
      });
      return { claimed: true, transactionId: bytesToUuid(id) };
    });

    const result = this.toResult(account, period, {
      interestMinor,
      averageMinor,
      preview: false,
      transactionId: outcome.transactionId,
    });
    const posted = outcome.claimed;

    if (posted) {
      this.audit.record('ledger.interest.posted', {
        owner: scope.key,
        accountId: bytesToUuid(account.id),
        reason,
        interestMinor,
        from: toDateOnlyString(period.from),
        to: toDateOnlyString(period.to),
        transactionId: result.transactionId,
      });
    }
    return { result, posted };
  }

  /** 系统流水必须挂在某个用户上：个人账户即本人，家庭账户记在户主名下。 */
  private async systemActorId(account: Account): Promise<IdBytes> {
    if (account.ownerType === 'user') return account.ownerId;

    const household = await this.prisma.household.findUnique({
      where: { id: account.ownerId },
      select: { ownerUserId: true },
    });
    if (!household) {
      throw new BadRequestException({ code: 'HOUSEHOLD_NOT_FOUND', message: '账户所属家庭不存在' });
    }
    return household.ownerUserId;
  }

  private async accrual(account: Account, period: Period): Promise<{ interestMinor: number; averageMinor: number }> {
    const daily = await this.balance.dailyBalances(account, period.from, period.to);
    return {
      interestMinor: interestFromDailySum(Number(daily.dailySumMinor), account.interestRateBp ?? 0),
      averageMinor: Number(daily.averageMinor),
    };
  }

  private toResult(
    account: Account,
    period: Period,
    extra: { interestMinor: number; averageMinor: number; preview: boolean; transactionId: string | null },
  ): InterestRunResultVo {
    const vo = new InterestRunResultVo();
    vo.accountId = bytesToUuid(account.id);
    vo.accountName = account.name;
    vo.from = toDateOnlyString(period.from);
    vo.to = toDateOnlyString(period.to);
    vo.days = Math.max(0, Math.round((period.to.getTime() - period.from.getTime()) / 86_400_000) + 1);
    vo.averageBalanceMinor = extra.averageMinor;
    vo.interestMinor = extra.interestMinor;
    vo.due = period.due;
    vo.nextDueAt = toDateOnlyString(period.nextDueAt);
    vo.preview = extra.preview;
    vo.transactionId = extra.transactionId;
    return vo;
  }

  private async accruingAccounts(scope: OwnerScope): Promise<Account[]> {
    return this.prisma.account.findMany({
      where: {
        ...this.scopes.filter(scope),
        deletedAt: null,
        interestRateBp: { not: null },
        interestFreq: { not: null },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async requireInterestAccount(userId: string, id: string): Promise<Account> {
    const { row } = await this.accounts.requireScoped(userId, id);
    if (row.interestRateBp === null || row.interestFreq === null) {
      throw new BadRequestException({
        code: 'INTEREST_NOT_CONFIGURED',
        message: '该账户未开启计息，请先设置年化利率与结息周期',
      });
    }
    return row;
  }
}
