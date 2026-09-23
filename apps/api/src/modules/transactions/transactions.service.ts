import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Account, Category, Prisma, Transaction } from '@prisma/client';
import {
  DEFAULT_CURRENCY,
  formatMoney,
  isAllocationValid,
  type AllocationRole,
  type Paginated,
  type TransactionSummaryDto,
  type TransactionType,
} from '@itemlife/shared';
import Redis from 'ioredis';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { OwnerScopeService, type OwnerScope } from '../../common/scope/owner-scope.service';
import { decodeCursor, encodeCursor, parseLimit } from '../../common/utils/cursor';
import { addDaysUtc, parseDateOnly, startOfDayUtc, toDateOnlyString } from '../../common/utils/date';
import { bytesToUuid, newId, toIdBytes, type IdBytes } from '../../common/utils/id';
import type {
  CreateTransactionDto,
  InlineAccessoryDto,
  InlineNewItemDto,
  ListTransactionsQueryDto,
  SummaryQueryDto,
  TransactionItemDto,
  UpdateTransactionDto,
} from './dto/transaction.dto';
import { TransactionVo } from './dto/transaction.vo';

/** 列表 / 详情统一带上账户与分类快照，前端无需二次映射（设计报告 8.2）。 */
const TRANSACTION_INCLUDE = {
  account: { select: { id: true, name: true, type: true } },
  category: { select: { id: true, name: true, icon: true, color: true } },
  itemLinks: { select: { itemId: true, amountMinor: true, role: true, accessoryId: true } },
} satisfies Prisma.TransactionInclude;

const IDEMPOTENCY_TTL_SECONDS = 24 * 3600;
const IDEMPOTENCY_LOCK_SECONDS = 60;

/** 内联新建批次未填名称时的兜底名：与物品页「添加批次」保持一致。 */
const DEFAULT_ACCESSORY_NAME = '配件';

/** 分摊金额：null 表示继承整笔流水金额（单物品场景）。 */
function effectiveAmount(row: ResolvedAllocation, transactionAmountMinor: number): number {
  return row.amountMinor === null ? transactionAmountMinor : Number(row.amountMinor);
}

interface ResolvedAllocation {
  /** 已有物品；内联新建的行先为 null，落库后回填 */
  itemId: IdBytes | null;
  /** 引用同一笔流水内 newItem 键的临时引用 */
  itemRef: string | null;
  amountMinor: bigint | null;
  role: AllocationRole;
  accessoryId: IdBytes | null;
  newItem: InlineNewItemDto | null;
  /** 内联物品的分类（已校验归属），落库时直接用 */
  newItemCategoryId: IdBytes | null;
  newAccessory: InlineAccessoryDto | null;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: OwnerScopeService,
    private readonly audit: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async list(userId: string, query: ListTransactionsQueryDto): Promise<Paginated<TransactionVo>> {
    const scope = await this.scopes.resolve(userId, query.domain);
    const limit = parseLimit(query.limit, 20, 100);
    const where = this.buildWhere(scope, query);
    const cursorId = toIdBytes(parseCursorId(query.cursor) ?? undefined);

    // 键集分页：游标指向上一页最后一条，Prisma 按 (occurred_at, id) 复合顺序做 seek，翻页不漂移
    const rows = await this.prisma.transaction.findMany({
      where,
      include: TRANSACTION_INCLUDE,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    const total = await this.prisma.transaction.count({ where });

    return {
      items: page.map((row) => TransactionVo.from(row)),
      nextCursor: hasMore && last ? encodeCursor({ id: bytesToUuid(last.id) }) : null,
      total,
    };
  }

  async summary(userId: string, query: SummaryQueryDto): Promise<TransactionSummaryDto> {
    const scope = await this.scopes.resolve(userId, query.domain);
    const from = parseDateOnly(query.from);
    const to = parseDateOnly(query.to);
    if (!from || !to) throw invalidRange();
    if (to < from) throw invalidRange('结束日期不能早于开始日期');

    const accountId = query.accountId ? this.requireId(query.accountId) : null;
    const grouped = await this.prisma.transaction.groupBy({
      by: ['type'],
      where: {
        ...this.scopes.filter(scope),
        deletedAt: null,
        occurredAt: { gte: from, lt: addDaysUtc(to, 1) },
        ...(accountId ? { accountId } : {}),
      },
      _sum: { amountMinor: true },
    });

    let incomeMinor = 0;
    let expenseMinor = 0;
    for (const row of grouped) {
      const sum = Number(row._sum?.amountMinor ?? 0n);
      if (row.type === 'income') incomeMinor += sum;
      else if (row.type === 'expense') expenseMinor += sum;
    }

    return {
      from: toDateOnlyString(from),
      to: toDateOnlyString(to),
      incomeMinor,
      expenseMinor,
      netMinor: incomeMinor - expenseMinor,
    };
  }

  /** 记一笔：转账成对写入两条腿，共享 transfer_group_id；可选 Idempotency-Key 防移动端重复提交。 */
  async create(userId: string, dto: CreateTransactionDto, idempotencyKey?: string): Promise<TransactionVo> {
    const scope = await this.scopes.resolveFromBody(userId, dto.owner);
    const key = idempotencyKey?.trim();
    if (key) {
      const replay = await this.beginIdempotency(scope, key);
      if (replay) return replay;
    }

    try {
      const created = await this.write(userId, scope, dto);
      if (key) await this.rememberIdempotency(scope, key, created.id);
      return created;
    } catch (error) {
      if (key) await this.forgetIdempotency(scope, key);
      throw error;
    }
  }

  async update(userId: string, id: string, dto: UpdateTransactionDto): Promise<TransactionVo> {
    const { row, scope } = await this.requireTransaction(userId, id);
    const isTransfer = Boolean(row.transferGroupId);
    const amount = dto.amountMinor ?? Number(row.amountMinor);

    if (isTransfer) {
      if (dto.accountId) throw transferImmutable('转账不支持改账户，请删除后重记');
      if (dto.categoryId) throw transferImmutable('转账不涉及分类');
      if (dto.items) throw transferImmutable('转账不涉及物品分摊');
    }

    const allocations =
      !isTransfer && dto.items !== undefined
        ? await this.resolveAllocations(scope, dto.items, amount, { currentTransactionId: row.id })
        : null;
    const categoryId =
      !isTransfer && dto.categoryId !== undefined
        ? dto.categoryId === null
          ? null
          : (await this.requireCategory(scope, this.requireId(dto.categoryId), row.type as TransactionType)).id
        : undefined;
    const accountId =
      !isTransfer && dto.accountId !== undefined
        ? (await this.requireAccount(scope, this.requireId(dto.accountId))).id
        : undefined;
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : undefined;

    const shared: Prisma.TransactionUpdateManyMutationInput = {
      ...(dto.amountMinor !== undefined ? { amountMinor: BigInt(dto.amountMinor) } : {}),
      ...(occurredAt ? { occurredAt } : {}),
      ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
    };

    if (isTransfer) {
      await this.prisma.transaction.updateMany({
        where: { transferGroupId: row.transferGroupId, deletedAt: null },
        data: shared,
      });
    } else {
      await this.prisma.$transaction(async (tx) => {
        await tx.transaction.update({
          where: { id: row.id },
          data: {
            ...shared,
            ...(categoryId !== undefined ? { categoryId } : {}),
            ...(accountId !== undefined ? { accountId } : {}),
          },
        });
        if (allocations) {
          await tx.transactionItem.deleteMany({ where: { transactionId: row.id } });
          await this.settleAccessoryBatches(tx, row.id, allocations, startOfDayUtc(occurredAt ?? row.occurredAt));
          await this.writeAllocations(tx, row.id, allocations);
          await this.pinPurchaseTransactions(tx, row.id, allocations);
        }
      });
    }

    this.audit.record('ledger.transaction.updated', { userId, transactionId: id, transfer: isTransfer });
    return this.findById(scope, row.id);
  }

  /** 软删除：删整笔，转账连带删除成对的另一条腿；余额随之下一次派生自动回滚。 */
  async remove(userId: string, id: string): Promise<null> {
    const { row, scope } = await this.requireTransaction(userId, id);
    const deletedAt = new Date();

    if (row.transferGroupId) {
      await this.prisma.transaction.updateMany({
        where: { transferGroupId: row.transferGroupId, deletedAt: null },
        data: { deletedAt },
      });
    } else {
      await this.prisma.transaction.update({ where: { id: row.id }, data: { deletedAt } });
    }

    this.audit.record('ledger.transaction.deleted', {
      userId,
      transactionId: id,
      owner: scope.key,
      transfer: Boolean(row.transferGroupId),
    });
    return null;
  }

  private async write(userId: string, scope: OwnerScope, dto: CreateTransactionDto): Promise<TransactionVo> {
    if (dto.type === 'transfer_in') {
      throw new BadRequestException({
        code: 'TRANSFER_DIRECTION_INVALID',
        message: '转账请以 type=transfer_out 提交并附 toAccountId，服务端会成对写入两条腿',
      });
    }

    if (!dto.accountId) {
      throw new BadRequestException({ code: 'ACCOUNT_REQUIRED', message: '请选择账户' });
    }
    if (dto.type === 'transfer_out' && !dto.toAccountId) {
      throw new BadRequestException({ code: 'TO_ACCOUNT_REQUIRED', message: '请选择转入账户' });
    }

    const amountMinor = BigInt(dto.amountMinor);
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    const account = await this.requireAccount(scope, this.requireId(dto.accountId));
    const note = dto.note?.trim() || null;

    if (dto.type === 'transfer_out') {
      if (dto.categoryId) throw new BadRequestException({ code: 'TRANSFER_CATEGORY_FORBIDDEN', message: '转账不涉及分类' });
      if (dto.items?.length) throw new BadRequestException({ code: 'TRANSFER_ITEM_FORBIDDEN', message: '转账不涉及物品分摊' });

      const toAccount = await this.requireAccount(scope, this.requireId(dto.toAccountId));
      if (bytesToUuid(toAccount.id) === bytesToUuid(account.id)) {
        throw new BadRequestException({ code: 'TRANSFER_SAME_ACCOUNT', message: '转出与转入账户不能是同一个' });
      }

      const transferGroupId = newId();
      const outId = newId();
      const inId = newId();
      await this.prisma.transaction.createMany({
        data: [
          {
            id: outId,
            ...this.scopes.filter(scope),
            type: 'transfer_out',
            amountMinor,
            accountId: account.id,
            occurredAt,
            note,
            transferGroupId,
            createdBy: this.requireId(userId),
          },
          {
            id: inId,
            ...this.scopes.filter(scope),
            type: 'transfer_in',
            amountMinor,
            accountId: toAccount.id,
            occurredAt,
            note,
            transferGroupId,
            createdBy: this.requireId(userId),
          },
        ],
      });

      this.audit.record('ledger.transfer.created', {
        userId,
        owner: scope.key,
        amountMinor: dto.amountMinor,
        fromAccountId: bytesToUuid(account.id),
        toAccountId: bytesToUuid(toAccount.id),
      });
      return this.findById(scope, outId);
    }

    const categoryId = dto.categoryId
      ? (await this.requireCategory(scope, this.requireId(dto.categoryId), dto.type)).id
      : null;
    const allocations = await this.resolveAllocations(scope, dto.items, dto.amountMinor, { allowInline: true });
    const id = newId();
    const occurredDate = startOfDayUtc(occurredAt);

    await this.prisma.$transaction(async (tx) => {
      await this.createInlineItems(tx, scope, id, allocations, occurredDate, dto.amountMinor);
      await tx.transaction.create({
        data: {
          id,
          ...this.scopes.filter(scope),
          type: dto.type,
          amountMinor,
          accountId: account.id,
          categoryId,
          occurredAt,
          note,
          currency: account.currency || DEFAULT_CURRENCY,
          createdBy: this.requireId(userId),
        },
      });
      await this.settleAccessoryBatches(tx, id, allocations, occurredDate);
      await this.writeAllocations(tx, id, allocations);
      await this.pinPurchaseTransactions(tx, id, allocations);
    });

    this.audit.record('ledger.transaction.created', {
      userId,
      owner: scope.key,
      type: dto.type,
      amountMinor: dto.amountMinor,
      accountId: bytesToUuid(account.id),
      allocationCount: allocations.length,
    });
    return this.findById(scope, id);
  }

  /** 内联新建物品：先落库拿到 id，再回填 itemRef 引用；本体价取本行的分摊金额。 */
  private async createInlineItems(
    tx: Prisma.TransactionClient,
    scope: OwnerScope,
    transactionId: IdBytes,
    allocations: ResolvedAllocation[],
    purchaseDate: Date,
    amountMinor: number,
  ): Promise<void> {
    const created = new Map<string, IdBytes>();
    for (const row of allocations) {
      if (!row.newItem) continue;
      const itemId = newId();
      await tx.item.create({
        data: {
          id: itemId,
          ...this.scopes.filter(scope),
          name: row.newItem.name.trim(),
          categoryId: row.newItemCategoryId,
          purchaseDate,
          purchasePriceMinor: BigInt(row.role === 'body' ? effectiveAmount(row, amountMinor) : 0),
          expectedLifespanDays: row.newItem.expectedLifespanDays ?? null,
          status: 'in_use',
          note: row.newItem.note?.trim() || null,
          purchaseTransactionId: transactionId,
        },
      });
      row.itemId = itemId;
      if (row.newItem.key) created.set(row.newItem.key, itemId);
    }

    for (const row of allocations) {
      if (row.itemRef && !row.itemId) row.itemId = created.get(row.itemRef) ?? null;
    }
  }

  /**
   * 批次绑定：先解掉本笔流水原有的绑定（编辑时重建分摊），再新建批次或把已有批次指回本笔。
   * 批次单价 × 总数 与分摊金额的一致性已在 resolveAllocations 校验过。
   */
  private async settleAccessoryBatches(
    tx: Prisma.TransactionClient,
    transactionId: IdBytes,
    allocations: ResolvedAllocation[],
    fallbackDate: Date,
  ): Promise<void> {
    await tx.itemAccessory.updateMany({ where: { transactionId }, data: { transactionId: null } });

    for (const row of allocations) {
      if (row.role !== 'accessory' || !row.itemId) continue;
      const amount = effectiveAmount(row, Number(row.amountMinor ?? 0n));

      if (row.newAccessory) {
        const id = newId();
        await tx.itemAccessory.create({
          data: {
            id,
            itemId: row.itemId,
            name: row.newAccessory.name?.trim() || DEFAULT_ACCESSORY_NAME,
            unitPriceMinor: BigInt(amount / row.newAccessory.totalQty),
            totalQty: row.newAccessory.totalQty,
            purchasedAt: parseDateOnly(row.newAccessory.purchasedAt) ?? fallbackDate,
            transactionId,
          },
        });
        row.accessoryId = id;
      } else if (row.accessoryId) {
        await tx.itemAccessory.update({ where: { id: row.accessoryId }, data: { transactionId } });
      }
    }
  }

  private async writeAllocations(
    tx: Prisma.TransactionClient,
    transactionId: IdBytes,
    allocations: ResolvedAllocation[],
  ): Promise<void> {
    if (allocations.length === 0) return;
    await tx.transactionItem.createMany({
      data: allocations.map((row) => ({
        id: newId(),
        transactionId,
        itemId: row.itemId!,
        amountMinor: row.amountMinor,
        role: row.role,
        accessoryId: row.accessoryId,
      })),
    });
  }

  /** 本体采购流水指针：只在物品尚未指向任何采购流水时写入，避免覆盖首次记录。 */
  private async pinPurchaseTransactions(
    tx: Prisma.TransactionClient,
    transactionId: IdBytes,
    allocations: ResolvedAllocation[],
  ): Promise<void> {
    for (const row of allocations) {
      if (row.role !== 'body' || !row.itemId) continue;
      await tx.item.updateMany({
        where: { id: row.itemId, purchaseTransactionId: null },
        data: { purchaseTransactionId: transactionId },
      });
    }
  }

  /**
   * 物品分摊校验（联动调整方案 §5.3 / §5.4）：
   * Σ分摊 ≤ 金额；多物品必须逐项填写；目标物品/批次必须同域；
   * role=accessory 必须绑定批次，且「批次单价 × 总数 = 分摊金额」不符即 409。
   */
  private async resolveAllocations(
    scope: OwnerScope,
    items: TransactionItemDto[] | undefined,
    amountMinor: number,
    options: { allowInline?: boolean; currentTransactionId?: IdBytes } = {},
  ): Promise<ResolvedAllocation[]> {
    if (!items || items.length === 0) return [];

    const allowInline = options.allowInline ?? false;
    const seenItems = new Set<string>();
    const seenRefs = new Set<string>();
    const inlineKeys = new Set<string>();
    const parsed: ResolvedAllocation[] = [];

    for (const raw of items) {
      const targets = [raw.itemId, raw.itemRef, raw.newItem].filter((value) => value !== undefined && value !== null);
      if (targets.length !== 1) {
        throw new BadRequestException({
          code: 'ALLOCATION_TARGET_INVALID',
          message: '每行分摊必须且只能指定 itemId / itemRef / newItem 之一',
        });
      }
      if (raw.newItem && !allowInline) {
        throw new BadRequestException({
          code: 'INLINE_CREATE_NOT_ALLOWED',
          message: '编辑流水不支持内联新建物品或批次，请先在「物品」页录入',
        });
      }
      if (raw.itemRef && !raw.itemRef.trim()) {
        throw new BadRequestException({ code: 'ALLOCATION_TARGET_INVALID', message: 'itemRef 不能为空' });
      }

      if (raw.itemRef) {
        if (!allowInline) {
          throw new BadRequestException({
            code: 'INLINE_CREATE_NOT_ALLOWED',
            message: '编辑流水不支持内联新建物品或批次，请先在「物品」页录入',
          });
        }
        if (seenRefs.has(raw.itemRef)) {
          throw new BadRequestException({ code: 'DUPLICATE_ITEM', message: '同一物品只能分摊一次' });
        }
        seenRefs.add(raw.itemRef);
      }

      if (raw.newItem?.key) {
        if (inlineKeys.has(raw.newItem.key)) {
          throw new BadRequestException({ code: 'DUPLICATE_INLINE_KEY', message: '内联新建物品的临时键不能重复' });
        }
        inlineKeys.add(raw.newItem.key);
      }

      const itemId = raw.itemId ? this.requireId(raw.itemId) : null;
      if (itemId) {
        const key = bytesToUuid(itemId);
        if (seenItems.has(key)) {
          throw new BadRequestException({ code: 'DUPLICATE_ITEM', message: '同一物品只能分摊一次' });
        }
        seenItems.add(key);
      }

      const role: AllocationRole = raw.role ?? (raw.newItem ? 'body' : 'link');
      const isInline = Boolean(raw.newItem) || Boolean(raw.itemRef);
      if (isInline && role !== 'body' && role !== 'fee') {
        throw new BadRequestException({
          code: 'ALLOCATION_ROLE_INVALID',
          message: '新建物品只能作为本体或附加费用入账',
        });
      }

      const amount = raw.amountMinor === null || raw.amountMinor === undefined ? null : BigInt(raw.amountMinor);
      if (role === 'accessory') {
        if (!raw.accessoryId && !raw.newAccessory) {
          throw new BadRequestException({
            code: 'ACCESSORY_BATCH_REQUIRED',
            message: '配件采购必须挂到具体批次：选择已有批次或当场新建',
          });
        }
        if (raw.accessoryId && raw.newAccessory) {
          throw new BadRequestException({ code: 'ACCESSORY_BATCH_CONFLICT', message: '已有批次与新建批次不能同时指定' });
        }
        if (raw.accessoryId && !itemId) {
          throw new BadRequestException({
            code: 'ACCESSORY_BATCH_INVALID',
            message: '已有批次必须与 itemId 一起提交',
          });
        }
        if (amount === null) {
          throw new BadRequestException({
            code: 'ALLOCATION_AMOUNT_REQUIRED',
            message: '配件采购必须写明分摊金额',
          });
        }
        if (raw.newAccessory) {
          assertAccessoryAmountMatches(Number(amount), null, raw.newAccessory.totalQty);
        }
      } else if (raw.accessoryId || raw.newAccessory) {
        throw new BadRequestException({
          code: 'ACCESSORY_ROLE_INVALID',
          message: '只有用途为「配件」的分摊才能挂批次',
        });
      }

      parsed.push({
        itemId,
        itemRef: raw.itemRef?.trim() ?? null,
        amountMinor: amount,
        role,
        accessoryId: raw.accessoryId ? this.requireId(raw.accessoryId) : null,
        newItem: raw.newItem ?? null,
        newItemCategoryId: null,
        newAccessory: raw.newAccessory ?? null,
      });
    }

    if (parsed.length > 1 && parsed.some((item) => item.amountMinor === null)) {
      throw new BadRequestException({
        code: 'ALLOCATION_AMOUNT_REQUIRED',
        message: '多个物品时必须逐项填写分摊金额，只有单物品可以留空继承整笔金额',
      });
    }

    for (const row of parsed) {
      if (row.itemRef && !inlineKeys.has(row.itemRef)) {
        throw new BadRequestException({
          code: 'ITEM_REF_UNKNOWN',
          message: 'itemRef 未指向本笔流水中新建的物品',
        });
      }
    }

    await this.verifyAllocationTargets(scope, parsed, options);

    const allocations = parsed.map((item) => ({
      amountMinor: item.amountMinor === null ? null : Number(item.amountMinor),
    }));
    if (!isAllocationValid(amountMinor, allocations)) {
      throw new BadRequestException({
        code: 'ALLOCATION_EXCEEDS_AMOUNT',
        message: '物品分摊合计不能超过流水金额',
      });
    }
    return parsed;
  }

  /** 目标存在性与同域校验：已有物品 / 已有批次 / 内联新建物品的分类。 */
  private async verifyAllocationTargets(
    scope: OwnerScope,
    rows: ResolvedAllocation[],
    options: { currentTransactionId?: IdBytes },
  ): Promise<void> {
    const itemIds = rows.flatMap((row) => (row.itemId ? [row.itemId] : []));
    if (itemIds.length > 0) {
      const found = await this.prisma.item.findMany({
        where: { ...this.scopes.filter(scope), id: { in: itemIds }, deletedAt: null },
        select: { id: true },
      });
      if (found.length !== itemIds.length) {
        throw new NotFoundException({ code: 'ITEM_NOT_FOUND', message: '物品不存在或无权访问' });
      }
    }

    for (const row of rows) {
      if (row.newItem?.categoryId) {
        row.newItemCategoryId = (await this.requireCategory(scope, this.requireId(row.newItem.categoryId), 'expense')).id;
      }
    }

    const batchIds = rows.flatMap((row) => (row.accessoryId ? [row.accessoryId] : []));
    if (batchIds.length === 0) return;

    const batches = await this.prisma.itemAccessory.findMany({ where: { id: { in: batchIds } } });
    const byId = new Map(batches.map((batch) => [bytesToUuid(batch.id), batch]));
    for (const row of rows) {
      if (!row.accessoryId) continue;
      const batch = byId.get(bytesToUuid(row.accessoryId));
      if (!batch) {
        throw new NotFoundException({ code: 'ACCESSORY_NOT_FOUND', message: '配件批次不存在或无权访问' });
      }
      if (!row.itemId || bytesToUuid(batch.itemId) !== bytesToUuid(row.itemId)) {
        throw new BadRequestException({ code: 'ACCESSORY_ITEM_MISMATCH', message: '配件批次不属于该物品' });
      }
      const boundTo = batch.transactionId ? bytesToUuid(batch.transactionId) : null;
      const current = options.currentTransactionId ? bytesToUuid(options.currentTransactionId) : null;
      if (boundTo && boundTo !== current) {
        throw new ConflictException({
          code: 'ACCESSORY_ALREADY_BOUND',
          message: '该批次已绑定其他流水，不能重复挂账',
        });
      }
      assertAccessoryAmountMatches(Number(row.amountMinor ?? 0n), Number(batch.unitPriceMinor), batch.totalQty);
    }
  }

  private async requireAccount(scope: OwnerScope, id: IdBytes): Promise<Account> {
    const account = await this.prisma.account.findFirst({
      where: { ...this.scopes.filter(scope), id, deletedAt: null },
    });
    if (!account) throw new NotFoundException({ code: 'ACCOUNT_NOT_FOUND', message: '账户不存在或无权访问' });
    return account;
  }

  private async requireCategory(scope: OwnerScope, id: IdBytes, type: TransactionType): Promise<Category> {
    const category = await this.prisma.category.findFirst({
      where: { ...this.scopes.filter(scope), id, deletedAt: null },
    });
    if (!category) throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: '分类不存在或无权访问' });

    const expected = type === 'income' ? 'income' : 'expense';
    if (category.kind !== expected) {
      throw new BadRequestException({ code: 'CATEGORY_KIND_MISMATCH', message: '分类的收支类型与流水不一致' });
    }
    return category;
  }

  private async requireTransaction(
    userId: string,
    id: string,
  ): Promise<{ row: Transaction; scope: OwnerScope }> {
    const bytes = toIdBytes(id);
    const row = bytes
      ? await this.prisma.transaction.findFirst({ where: { id: bytes, deletedAt: null } })
      : null;
    if (!row) throw transactionNotFound();
    return { row, scope: await this.scopes.resolveOwned(userId, row.ownerType, row.ownerId, transactionNotFound) };
  }

  private async findById(scope: OwnerScope, id: IdBytes): Promise<TransactionVo> {
    const row = await this.prisma.transaction.findFirst({
      where: { ...this.scopes.filter(scope), id },
      include: TRANSACTION_INCLUDE,
    });
    if (!row) throw transactionNotFound();
    return TransactionVo.from(row);
  }

  private buildWhere(scope: OwnerScope, query: ListTransactionsQueryDto): Prisma.TransactionWhereInput {
    const from = parseDateOnly(query.from);
    const to = parseDateOnly(query.to);
    const keyword = query.keyword?.trim();

    return {
      ...this.scopes.filter(scope),
      deletedAt: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.accountId ? { accountId: this.requireId(query.accountId) } : {}),
      ...(query.categoryId ? { categoryId: this.requireId(query.categoryId) } : {}),
      ...(query.itemId ? { itemLinks: { some: { itemId: this.requireId(query.itemId) } } } : {}),
      ...(from || to
        ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: addDaysUtc(to, 1) } : {}) } }
        : {}),
      ...(keyword ? { note: { contains: keyword } } : {}),
    };
  }

  private requireId(value: string | null | undefined): IdBytes {
    const bytes = toIdBytes(value);
    if (!bytes) {
      throw new BadRequestException({ code: 'INVALID_ID', message: 'ID 格式不正确' });
    }
    return bytes;
  }

  /** 幂等键：SETNX 抢占 60 秒锁，重复请求直接回放首次结果（设计报告 8.2）。 */
  private async beginIdempotency(scope: OwnerScope, key: string): Promise<TransactionVo | null> {
    const redisKey = idempotencyKey(scope, key);
    try {
      const reserved = await this.redis.set(redisKey, 'pending', 'EX', IDEMPOTENCY_LOCK_SECONDS, 'NX');
      if (reserved === 'OK') return null;

      const existing = await this.redis.get(redisKey);
      if (!existing || existing === 'pending') {
        throw new ConflictException({ code: 'REQUEST_IN_PROGRESS', message: '相同请求正在处理中，请勿重复提交' });
      }
      const bytes = toIdBytes(existing);
      const replay = bytes ? await this.prisma.transaction.findFirst({
        where: { ...this.scopes.filter(scope), id: bytes },
        include: TRANSACTION_INCLUDE,
      }) : null;
      if (replay) return TransactionVo.from(replay);
      await this.redis.del(redisKey);
      return null;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      // Redis 不可用时降级为「无幂等保护」，不能阻塞记账主流程
      this.logger.warn(`幂等键不可用，已降级：${(error as Error).message}`);
      return null;
    }
  }

  private async rememberIdempotency(scope: OwnerScope, key: string, transactionId: string): Promise<void> {
    await this.redis
      .set(idempotencyKey(scope, key), transactionId, 'EX', IDEMPOTENCY_TTL_SECONDS)
      .catch((error: Error) => this.logger.warn(`幂等结果写入失败：${error.message}`));
  }

  private async forgetIdempotency(scope: OwnerScope, key: string): Promise<void> {
    await this.redis.del(idempotencyKey(scope, key)).catch(() => undefined);
  }
}

function idempotencyKey(scope: OwnerScope, key: string): string {
  return `idem:tx:${scope.key}:${key}`;
}

/** 游标只编码上一条的 id：排序键由服务端 orderBy 决定，前端无需理解。 */
function parseCursorId(raw: string | undefined): string | null {
  const cursor = decodeCursor(raw);
  return typeof cursor?.id === 'string' ? cursor.id : null;
}

function transactionNotFound(): NotFoundException {
  return new NotFoundException({ code: 'TRANSACTION_NOT_FOUND', message: '流水不存在或无权访问' });
}

function transferImmutable(message: string): BadRequestException {
  return new BadRequestException({ code: 'TRANSFER_IMMUTABLE_FIELD', message });
}

function invalidRange(message = '日期格式不正确，应为 YYYY-MM-DD'): BadRequestException {
  return new BadRequestException({ code: 'INVALID_DATE_RANGE', message });
}

/**
 * 批次金额一致性（Q9 定案：硬拦 409，不做静默纠正）。
 * unitPriceMinor 为 null 表示批次当场新建、单价待反算，此时要求「金额 ÷ 数量」整除。
 */
function assertAccessoryAmountMatches(
  amountMinor: number,
  unitPriceMinor: number | null,
  totalQty: number,
): void {
  if (unitPriceMinor === null) {
    const remainder = amountMinor % totalQty;
    if (remainder !== 0) {
      throw new ConflictException({
        code: 'ACCESSORY_AMOUNT_MISMATCH',
        message: `金额 ${formatMoney(amountMinor)} ÷ ${totalQty} 个除不尽（余 ${formatMoney(remainder)}），请调整金额或数量`,
      });
    }
    return;
  }

  const expected = unitPriceMinor * totalQty;
  if (expected !== amountMinor) {
    throw new ConflictException({
      code: 'ACCESSORY_AMOUNT_MISMATCH',
      message: `批次单价 × 总数 = ${formatMoney(expected)}，与本行分摊 ${formatMoney(amountMinor)} 不符（差 ${formatMoney(amountMinor - expected)}）`,
    });
  }
}
