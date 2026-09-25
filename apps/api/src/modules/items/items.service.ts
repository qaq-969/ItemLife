import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Item, ItemAccessory } from '@prisma/client';
import type { CategoryBrief, ItemCostSummary, Paginated } from '@itemlife/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OwnerScopeService, type OwnerScope } from '../../common/scope/owner-scope.service';
import { decodeCursor, encodeCursor, parseLimit } from '../../common/utils/cursor';
import { parseDateOnly, startOfDayUtc } from '../../common/utils/date';
import { bytesToUuid, newId, toIdBytes, type IdBytes } from '../../common/utils/id';
import { TransactionVo } from '../transactions/dto/transaction.vo';
import { CostService, emptyCostContext, type ItemCostContext } from './cost.service';
import type {
  AccessoryQtyDto,
  CreateAccessoryDto,
  CreateItemDto,
  InventoryRevertDto,
  ListItemsQueryDto,
  UpdateItemDto,
} from './dto/item.dto';
import { AccessoryUsageVo, AccessoryVo, ItemDetailVo, ItemsOverviewVo, ItemVo } from './dto/item.vo';

/** 详情页的审计时间线一次最多展示这么多条（折线仍用全量）。 */
const USAGE_PAGE_SIZE = 100;
/** 看板成本排行榜长度。 */
const TOP_COSTLY_SIZE = 5;

const TRANSACTION_INCLUDE = {
  account: { select: { id: true, name: true, type: true } },
  category: { select: { id: true, name: true, icon: true, color: true } },
  itemLinks: {
    select: {
      id: true,
      itemId: true,
      parentId: true,
      name: true,
      amountMinor: true,
      role: true,
      accessoryId: true,
      item: { select: { name: true, deletedAt: true } },
      accessory: { select: { name: true, unitPriceMinor: true, firstUnitExtraMinor: true, totalQty: true, usedQty: true, revertedQty: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.TransactionInclude;

interface CostedItem {
  row: Item;
  context: ItemCostContext;
  cost: ItemCostSummary;
  accessoryCount: number;
}

/** 待入库的配件批次：DTO 校验通过后转成可写入的形状。 */
interface PreparedBatch {
  name: string;
  unitPriceMinor: bigint;
  totalQty: number;
  usedQty: number;
  purchasedAt: Date;
  transactionId: IdBytes | null;
}

export function itemNotFound(): NotFoundException {
  return new NotFoundException({ code: 'ITEM_NOT_FOUND', message: '物品不存在或无权访问' });
}

export function accessoryNotFound(): NotFoundException {
  return new NotFoundException({ code: 'ACCESSORY_NOT_FOUND', message: '配件不存在或无权访问' });
}

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: OwnerScopeService,
    private readonly cost: CostService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, query: ListItemsQueryDto): Promise<Paginated<ItemVo>> {
    const scope = await this.scopes.resolve(userId, query.domain);
    const where = this.buildWhere(scope, query);
    const limit = parseLimit(query.limit, 20, 100);
    const cursorId = toIdBytes(parseCursorId(query.cursor) ?? undefined);

    const rows = await this.prisma.item.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const total = await this.prisma.item.count({ where });

    return {
      items: await this.toVos(scope, await this.costedItems(page)),
      nextCursor: hasMore && last ? encodeCursor({ id: bytesToUuid(last.id) }) : null,
      total,
    };
  }

  /** 看板：总投入 / 持有成本 / 配件库存价值 / 在役数 / 成本排行（设计报告 6.2）。 */
  async overview(userId: string, query: ListItemsQueryDto): Promise<ItemsOverviewVo> {
    const scope = await this.scopes.resolve(userId, query.domain);
    const rows = await this.prisma.item.findMany({
      where: { ...this.scopes.filter(scope), deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const costed = await this.costedItems(rows);

    let payTotalMinor = 0;
    let holdCostMinor = 0;
    let remainingStockMinor = 0;
    let inUseCount = 0;
    for (const entry of costed) {
      payTotalMinor += entry.cost.payTotalMinor;
      holdCostMinor += entry.cost.holdCostMinor;
      remainingStockMinor += entry.cost.remainingStockMinor;
      if (entry.row.status === 'in_use') inUseCount += 1;
    }

    const top = [...costed]
      .sort(
        (left, right) =>
          right.cost.dailyHoldCostMinor - left.cost.dailyHoldCostMinor ||
          left.row.name.localeCompare(right.row.name, 'zh-Hans-CN'),
      )
      .slice(0, TOP_COSTLY_SIZE);

    return ItemsOverviewVo.from({
      payTotalMinor,
      holdCostMinor,
      remainingStockMinor,
      itemCount: costed.length,
      inUseCount,
      topCostly: await this.toVos(scope, top),
    });
  }

  /** 新建物品：可同时带入若干配件批次（含初始已用数，会写入审计）。 */
  async create(userId: string, dto: CreateItemDto): Promise<ItemVo> {
    const scope = await this.scopes.resolveFromBody(userId, dto.owner);
    const purchaseDate = this.requireDate(dto.purchaseDate, '购买日期');
    const categoryId = dto.categoryId ? (await this.requireCategory(scope, this.requireId(dto.categoryId))).id : null;
    const batches = await Promise.all(
      (dto.accessories ?? []).map((batch) => this.prepareBatch(scope, batch, purchaseDate)),
    );

    const id = newId();
    const actorId = this.requireId(userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.item.create({
        data: {
          id,
          ...this.scopes.filter(scope),
          name: dto.name.trim(),
          categoryId,
          purchaseDate,
          purchasePriceMinor: BigInt(dto.purchasePriceMinor),
          expectedLifespanDays: dto.expectedLifespanDays ?? null,
          status: dto.status ?? 'in_use',
          note: dto.note?.trim() || null,
        },
      });
      for (const batch of batches) {
        await this.writeBatch(tx, id, batch, actorId);
      }
    });

    this.audit.record('items.item.created', {
      userId,
      itemId: bytesToUuid(id),
      owner: scope.key,
      purchasePriceMinor: dto.purchasePriceMinor,
      accessoryCount: batches.length,
    });
    return this.findVo(scope, id);
  }

  async detail(userId: string, id: string): Promise<ItemDetailVo> {
    const { row, scope } = await this.requireItem(userId, id);
    return this.buildDetail(scope, row);
  }

  async update(userId: string, id: string, dto: UpdateItemDto): Promise<ItemVo> {
    const { row, scope } = await this.requireItem(userId, id);
    const categoryId =
      dto.categoryId === undefined
        ? undefined
        : dto.categoryId === null
          ? null
          : (await this.requireCategory(scope, this.requireId(dto.categoryId))).id;
    const purchaseDate = dto.purchaseDate === undefined ? undefined : this.requireDate(dto.purchaseDate, '购买日期');

    const updated = await this.prisma.item.update({
      where: { id: row.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(categoryId !== undefined ? { categoryId } : {}),
        ...(purchaseDate ? { purchaseDate } : {}),
        ...(dto.purchasePriceMinor !== undefined ? { purchasePriceMinor: BigInt(dto.purchasePriceMinor) } : {}),
        ...(dto.expectedLifespanDays !== undefined ? { expectedLifespanDays: dto.expectedLifespanDays } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
      },
    });

    this.audit.record('items.item.updated', { userId, itemId: bytesToUuid(row.id), owner: scope.key });
    return this.voOf(scope, updated);
  }

  /** 撤销物品库存：历史流水不改写，新增可追溯凭据后才软删除。 */
  async remove(userId: string, id: string, dto: InventoryRevertDto): Promise<null> {
    const { row, scope } = await this.requireItem(userId, id);
    const actorId = this.requireId(userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.inventoryRevert.create({
        data: { id: newId(), itemId: row.id, sourceTransactionId: row.purchaseTransactionId, kind: dto.kind ?? 'dispose', reason: dto.reason.trim(), createdBy: actorId },
      });
      await tx.item.update({ where: { id: row.id }, data: { deletedAt: new Date(), status: 'retired' } });
    });
    this.audit.record('items.item.reverted', { userId, itemId: bytesToUuid(row.id), owner: scope.key, kind: dto.kind ?? 'dispose' });
    return null;
  }

  async addAccessory(userId: string, itemId: string, dto: CreateAccessoryDto): Promise<AccessoryVo> {
    const { row, scope } = await this.requireItem(userId, itemId);
    const batch = await this.prepareBatch(scope, dto, startOfDayUtc(new Date()));
    const actorId = this.requireId(userId);

    const accessory = await this.prisma.$transaction((tx) => this.writeBatch(tx, row.id, batch, actorId));
    this.audit.record('items.accessory.added', {
      userId,
      itemId: bytesToUuid(row.id),
      accessoryId: bytesToUuid(accessory.id),
      owner: scope.key,
      totalQty: batch.totalQty,
    });
    return AccessoryVo.from(accessory);
  }

  /** 撤销批次库存：不删批次，写入数量和来源流水都可追溯。 */
  async removeAccessory(userId: string, id: string, dto: InventoryRevertDto): Promise<null> {
    const { accessory, item, scope } = await this.requireAccessory(userId, id);
    const remaining = accessory.totalQty - accessory.usedQty - accessory.revertedQty;
    const qty = dto.qty ?? remaining;
    if (qty > remaining) {
      throw new ConflictException({ code: 'ACCESSORY_REVERT_EXCEEDED', message: `该批次仅剩 ${remaining} 个可撤销` });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.itemAccessory.update({ where: { id: accessory.id }, data: { revertedQty: { increment: qty } } });
      await tx.inventoryRevert.create({
        data: { id: newId(), itemId: item.id, accessoryId: accessory.id, sourceTransactionId: accessory.transactionId, kind: dto.kind ?? 'dispose', qty, reason: dto.reason.trim(), createdBy: this.requireId(userId) },
      });
    });
    this.audit.record('items.accessory.reverted', {
      userId,
      itemId: bytesToUuid(item.id),
      accessoryId: bytesToUuid(accessory.id),
      owner: scope.key,
    });
    return null;
  }

  /** 使用配件：used_qty + n（≤ 剩余），同时落一条审计。 */
  consume(userId: string, id: string, dto: AccessoryQtyDto): Promise<AccessoryUsageVo> {
    return this.adjustUsage(userId, id, dto.qty ?? 1, 1);
  }

  /** 撤销消耗：used_qty − n（≥ 0），审计里记负数，成本随持有成本口径自动回落。 */
  restore(userId: string, id: string, dto: AccessoryQtyDto): Promise<AccessoryUsageVo> {
    return this.adjustUsage(userId, id, dto.qty ?? 1, -1);
  }

  private async adjustUsage(
    userId: string,
    id: string,
    qty: number,
    sign: 1 | -1,
  ): Promise<AccessoryUsageVo> {
    const { accessory, item, scope } = await this.requireAccessory(userId, id);
    const deltaQty = sign * qty;
    const usedQtyAfter = accessory.usedQty + deltaQty;

    if (usedQtyAfter < 0) {
      throw new BadRequestException({
        code: 'ACCESSORY_RESTORE_EXCEEDED',
        message: `该批次只用了 ${accessory.usedQty} 个，无法撤销 ${qty} 个`,
      });
    }
    if (usedQtyAfter > accessory.totalQty - accessory.revertedQty) {
      throw new BadRequestException({
        code: 'ACCESSORY_QTY_EXCEEDED',
        message: `该批次还剩 ${accessory.totalQty - accessory.usedQty - accessory.revertedQty} 个，不够消耗 ${qty} 个`,
      });
    }

    // 乐观锁：并发「使用」不会互相覆盖，冲突方重试即可
    const usage = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.itemAccessory.updateMany({
        where: { id: accessory.id, usedQty: accessory.usedQty },
        data: { usedQty: usedQtyAfter },
      });
      if (updated.count === 0) {
        throw new ConflictException({ code: 'ACCESSORY_CONFLICT', message: '配件数量刚被其他操作修改，请重试' });
      }
      return tx.accessoryUsage.create({
        data: {
          id: newId(),
          accessoryId: accessory.id,
          itemId: item.id,
          deltaQty,
          usedQtyAfter,
          actorUserId: this.requireId(userId),
        },
      });
    });

    this.audit.record(sign > 0 ? 'items.accessory.consumed' : 'items.accessory.restored', {
      userId,
      itemId: bytesToUuid(item.id),
      accessoryId: bytesToUuid(accessory.id),
      owner: scope.key,
      qty,
      usedQtyAfter,
    });
    return AccessoryUsageVo.from(usage, accessory.name, await this.actorName(userId));
  }

  /** 单条写入配件批次；初始已用数会补一条审计，保证 used_qty 与审计之和恒等。 */
  private async writeBatch(
    tx: Prisma.TransactionClient,
    itemId: IdBytes,
    batch: PreparedBatch,
    actorId: IdBytes,
  ): Promise<ItemAccessory> {
    const accessoryId = newId();
    const accessory: ItemAccessory = await tx.itemAccessory.create({
      data: {
        id: accessoryId,
        itemId,
        name: batch.name,
        unitPriceMinor: batch.unitPriceMinor,
        totalQty: batch.totalQty,
        usedQty: batch.usedQty,
        purchasedAt: batch.purchasedAt,
        transactionId: batch.transactionId,
      },
    });
    if (batch.usedQty > 0) {
      await tx.accessoryUsage.create({
        data: {
          id: newId(),
          accessoryId,
          itemId,
          deltaQty: batch.usedQty,
          usedQtyAfter: batch.usedQty,
          actorUserId: actorId,
        },
      });
    }
    return accessory;
  }

  private async buildDetail(scope: OwnerScope, row: Item): Promise<ItemDetailVo> {
    const context =
      (await this.cost.contextFor([row.id])).get(bytesToUuid(row.id)) ?? emptyCostContext();
    const accessories = context.accessories;
    // 折线要完整时间线，故取全量升序；展示的审计列表再倒序截断
    const usages = await this.prisma.accessoryUsage.findMany({
      where: { itemId: row.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const reverts = await this.prisma.inventoryRevert.findMany({
      where: { itemId: row.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: USAGE_PAGE_SIZE,
    });
    const nameById = new Map(accessories.map((accessory) => [bytesToUuid(accessory.id), accessory.name]));
    const actorNames = await this.actorNames(
      usages.map((usage) => usage.actorUserId).filter((id): id is IdBytes => Boolean(id)),
    );

    const base = await this.voOf(scope, row, context);
    return ItemDetailVo.detail(base, {
      accessories: accessories.map((accessory) => AccessoryVo.from(accessory)),
      usages: usages
        .slice(-USAGE_PAGE_SIZE)
        .reverse()
        .map((usage) =>
          AccessoryUsageVo.from(
            usage,
            nameById.get(bytesToUuid(usage.accessoryId)) ?? '',
            usage.actorUserId ? actorNames.get(bytesToUuid(usage.actorUserId)) ?? null : null,
          ),
        ),
      reverts: reverts.map((revert) => ({
        id: bytesToUuid(revert.id),
        kind: revert.kind,
        qty: revert.qty,
        reason: revert.reason,
        accessoryId: revert.accessoryId ? bytesToUuid(revert.accessoryId) : null,
        sourceTransactionId: revert.sourceTransactionId ? bytesToUuid(revert.sourceTransactionId) : null,
        createdAt: revert.createdAt.toISOString(),
      })),
      costTimeline: this.cost.timelineOf(
        row,
        context,
        usages.map((usage) => ({
          accessoryId: usage.accessoryId,
          deltaQty: usage.deltaQty,
          createdAt: usage.createdAt,
        })),
      ),
      transactions: await this.linkedTransactions(row.id),
    });
  }

  /** 关联流水：分摊表反查（含已软删的物品分摊记录，保持历史可见）。 */
  private async linkedTransactions(itemId: IdBytes): Promise<TransactionVo[]> {
    const links = await this.prisma.transactionItem.findMany({
      where: { itemId },
      select: { transactionId: true },
    });
    if (links.length === 0) return [];

    const rows = await this.prisma.transaction.findMany({
      where: { id: { in: links.map((link) => link.transactionId) }, deletedAt: null },
      include: TRANSACTION_INCLUDE,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map((transaction) => TransactionVo.from(transaction));
  }

  private async costedItems(rows: Item[]): Promise<CostedItem[]> {
    const contexts = await this.cost.contextFor(rows.map((row) => row.id));
    return rows.map((row) => {
      const context = contexts.get(bytesToUuid(row.id)) ?? emptyCostContext();
      return {
        row,
        context,
        cost: this.cost.metricsOf(row, context),
        accessoryCount: context.accessories.length,
      };
    });
  }

  private async toVos(scope: OwnerScope, costed: CostedItem[]): Promise<ItemVo[]> {
    const briefs = await this.categoryBriefs(
      scope,
      costed.map((entry) => entry.row.categoryId).filter((id): id is IdBytes => Boolean(id)),
    );
    return costed.map((entry) =>
      ItemVo.from(entry.row, entry.cost, {
        category: entry.row.categoryId ? briefs.get(bytesToUuid(entry.row.categoryId)) ?? null : null,
        accessoryCount: entry.accessoryCount,
      }),
    );
  }

  private async voOf(scope: OwnerScope, row: Item, context?: ItemCostContext): Promise<ItemVo> {
    const costContext = context ?? (await this.cost.contextFor([row.id])).get(bytesToUuid(row.id)) ?? emptyCostContext();
    const briefs = await this.categoryBriefs(scope, row.categoryId ? [row.categoryId] : []);
    return ItemVo.from(row, this.cost.metricsOf(row, costContext), {
      category: row.categoryId ? briefs.get(bytesToUuid(row.categoryId)) ?? null : null,
      accessoryCount: costContext.accessories.length,
    });
  }

  private async findVo(scope: OwnerScope, id: IdBytes): Promise<ItemVo> {
    const row = await this.prisma.item.findFirst({ where: { ...this.scopes.filter(scope), id, deletedAt: null } });
    if (!row) throw itemNotFound();
    return this.voOf(scope, row);
  }

  private async categoryBriefs(scope: OwnerScope, ids: IdBytes[]): Promise<Map<string, CategoryBrief>> {
    const briefs = new Map<string, CategoryBrief>();
    if (ids.length === 0) return briefs;

    const rows = await this.prisma.category.findMany({
      where: { ...this.scopes.filter(scope), id: { in: ids } },
      select: { id: true, name: true, icon: true, color: true },
    });
    for (const row of rows) {
      briefs.set(bytesToUuid(row.id), {
        id: bytesToUuid(row.id),
        name: row.name,
        icon: row.icon,
        color: row.color,
      });
    }
    return briefs;
  }

  private async actorName(userId: string): Promise<string | null> {
    const names = await this.actorNames([this.requireId(userId)]);
    return names.get(userId) ?? null;
  }

  private async actorNames(ids: IdBytes[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (ids.length === 0) return names;

    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, nickname: true, email: true },
    });
    for (const row of rows) names.set(bytesToUuid(row.id), row.nickname || row.email);
    return names;
  }

  private async prepareBatch(scope: OwnerScope, dto: CreateAccessoryDto, fallbackDate: Date): Promise<PreparedBatch> {
    const totalQty = dto.totalQty;
    const usedQty = dto.usedQty ?? 0;
    if (usedQty > totalQty) {
      throw new BadRequestException({
        code: 'ACCESSORY_QTY_EXCEEDED',
        message: '初始已用数量不能超过批次总数',
      });
    }

    const purchasedAt = dto.purchasedAt ? this.requireDate(dto.purchasedAt, '配件购入日期') : fallbackDate;
    const transactionId = dto.transactionId
      ? (await this.requireTransaction(scope, this.requireId(dto.transactionId))).id
      : null;

    return {
      name: dto.name.trim(),
      unitPriceMinor: BigInt(dto.unitPriceMinor),
      totalQty,
      usedQty,
      purchasedAt,
      transactionId,
    };
  }

  /** 按 id 定位物品并反查数据域（越权与不存在同为 404）。 */
  private async requireItem(userId: string, id: string): Promise<{ row: Item; scope: OwnerScope }> {
    const bytes = toIdBytes(id);
    const row = bytes ? await this.prisma.item.findFirst({ where: { id: bytes, deletedAt: null } }) : null;
    if (!row) throw itemNotFound();
    return { row, scope: await this.scopes.resolveOwned(userId, row.ownerType, row.ownerId, itemNotFound) };
  }

  /** 配件本身不带归属，经所属物品解析数据域。 */
  private async requireAccessory(
    userId: string,
    id: string,
  ): Promise<{ accessory: ItemAccessory; item: Item; scope: OwnerScope }> {
    const bytes = toIdBytes(id);
    const accessory = bytes ? await this.prisma.itemAccessory.findFirst({ where: { id: bytes } }) : null;
    if (!accessory) throw accessoryNotFound();

    const item = await this.prisma.item.findFirst({ where: { id: accessory.itemId, deletedAt: null } });
    if (!item) throw accessoryNotFound();
    return {
      accessory,
      item,
      scope: await this.scopes.resolveOwned(userId, item.ownerType, item.ownerId, accessoryNotFound),
    };
  }

  private async requireCategory(scope: OwnerScope, id: IdBytes): Promise<{ id: IdBytes }> {
    const category = await this.prisma.category.findFirst({
      where: { ...this.scopes.filter(scope), id, deletedAt: null },
      select: { id: true },
    });
    if (!category) throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: '分类不存在或无权访问' });
    return category;
  }

  private async requireTransaction(scope: OwnerScope, id: IdBytes): Promise<{ id: IdBytes }> {
    const transaction = await this.prisma.transaction.findFirst({
      where: { ...this.scopes.filter(scope), id, deletedAt: null },
      select: { id: true },
    });
    if (!transaction) {
      throw new NotFoundException({ code: 'TRANSACTION_NOT_FOUND', message: '流水不存在或无权访问' });
    }
    return transaction;
  }

  private requireDate(value: string, label: string): Date {
    const parsed = parseDateOnly(value);
    if (!parsed) {
      throw new BadRequestException({ code: 'INVALID_DATE', message: `${label}格式不正确，应为 YYYY-MM-DD` });
    }
    return parsed;
  }

  private requireId(value: string | null | undefined): IdBytes {
    const bytes = toIdBytes(value);
    if (!bytes) throw new BadRequestException({ code: 'INVALID_ID', message: 'ID 格式不正确' });
    return bytes;
  }

  private buildWhere(scope: OwnerScope, query: ListItemsQueryDto): Prisma.ItemWhereInput {
    const keyword = query.keyword?.trim();
    return {
      ...this.scopes.filter(scope),
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: this.requireId(query.categoryId) } : {}),
      ...(keyword ? { name: { contains: keyword } } : {}),
    };
  }
}

/** 游标只编码上一条的 id：排序键由服务端 orderBy 决定。 */
function parseCursorId(raw: string | undefined): string | null {
  const cursor = decodeCursor(raw);
  return typeof cursor?.id === 'string' ? cursor.id : null;
}
