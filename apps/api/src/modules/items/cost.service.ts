import { Injectable } from '@nestjs/common';
import type { Item, ItemAccessory } from '@prisma/client';
import {
  costMetricsOf,
  type AllocationSums,
  type CostPointDto,
  type ItemCostSummary,
} from '@itemlife/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { dayKey, toDateOnlyString } from '../../common/utils/date';
import { bytesToUuid, uuidToBytes, type IdBytes } from '../../common/utils/id';

/** 一次「使用 / 撤销」事件在成本演进上的输入。 */
export interface UsageDelta {
  accessoryId: IdBytes;
  deltaQty: number;
  createdAt: Date;
}

/** 一笔流水分摊在成本演进上的输入（只有 body / fee 直接抬升持有成本）。 */
export interface AllocationEvent {
  occurredAt: Date;
  amountMinor: number;
}

/** 单个物品的成本上下文：配件批次 + 流水分摊 + 未分摊金额。 */
export interface ItemCostContext {
  accessories: ItemAccessory[];
  allocations: AllocationSums;
  unallocatedMinor: number;
  events: AllocationEvent[];
}

/** 无任何配件与分摊时的空上下文（降级用，保证指标仍可计算）。 */
export function emptyCostContext(): ItemCostContext {
  return {
    accessories: [],
    allocations: { bodyMinor: 0, feeMinor: 0 },
    unallocatedMinor: 0,
    events: [],
  };
}

/**
 * 成本指标的唯一计算入口（设计报告 8.2）：公式本身在 @itemlife/shared，
 * 这里只负责批量取数与聚合，保证列表 / 详情 / 看板 / 前端共用同一口径。
 */
@Injectable()
export class CostService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 批量组装成本上下文，避免列表页 N+1：
   * 1) 配件批次按 itemId 归组；2) 流水分摊求和（软删流水整笔不计）；
   * 3) 关联流水的未分摊差额（流水金额 − Σ该笔所有分摊），供详情页提示。
   */
  async contextFor(itemIds: IdBytes[]): Promise<Map<string, ItemCostContext>> {
    const grouped = new Map<string, ItemCostContext>();
    if (itemIds.length === 0) return grouped;

    const contextOf = (key: string): ItemCostContext => {
      const existing = grouped.get(key);
      if (existing) return existing;
      const created = emptyCostContext();
      grouped.set(key, created);
      return created;
    };

    const accessories = await this.accessoriesByItem(itemIds);
    for (const [key, rows] of accessories) contextOf(key).accessories = rows;

    const links = await this.prisma.transactionItem.findMany({
      where: { itemId: { in: itemIds } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (links.length === 0) return grouped;

    const txKeys = [...new Set(links.map((link) => bytesToUuid(link.transactionId)))];
    const transactions = await this.prisma.transaction.findMany({
      where: { id: { in: txKeys.map((key) => uuidToBytes(key)) }, deletedAt: null },
      select: { id: true, amountMinor: true, occurredAt: true },
    });
    const alive = new Map(transactions.map((row) => [bytesToUuid(row.id), row]));
    if (alive.size === 0) return grouped;

    for (const link of links) {
      const txKey = bytesToUuid(link.transactionId);
      const transaction = alive.get(txKey);
      if (!transaction) continue;
      const amount = link.amountMinor === null ? Number(transaction.amountMinor) : Number(link.amountMinor);
      if (link.role === 'body' || link.role === 'fee') {
        const context = contextOf(bytesToUuid(link.itemId));
        if (link.role === 'body') context.allocations.bodyMinor += amount;
        else context.allocations.feeMinor += amount;
        context.events.push({ occurredAt: transaction.occurredAt, amountMinor: amount });
      }
    }

    await this.attachUnallocated(alive, txKeys, contextOf);
    return grouped;
  }

  /** 未分摊金额：某笔流水「金额 − Σ分摊」为正时，计入该笔所有关联物品的提示值。 */
  private async attachUnallocated(
    alive: Map<string, { amountMinor: bigint }>,
    txKeys: string[],
    contextOf: (key: string) => ItemCostContext,
  ): Promise<void> {
    const allocations = await this.prisma.transactionItem.findMany({
      where: { transactionId: { in: txKeys.map((key) => uuidToBytes(key)) } },
      select: { transactionId: true, itemId: true, amountMinor: true },
    });

    const allocatedByTx = new Map<string, number>();
    const itemsByTx = new Map<string, Set<string>>();
    for (const row of allocations) {
      const txKey = bytesToUuid(row.transactionId);
      if (!alive.has(txKey)) continue;
      const itemKey = bytesToUuid(row.itemId);
      allocatedByTx.set(txKey, (allocatedByTx.get(txKey) ?? 0) + Number(row.amountMinor ?? 0n));
      const bucket = itemsByTx.get(txKey);
      if (bucket) bucket.add(itemKey);
      else itemsByTx.set(txKey, new Set([itemKey]));
    }

    for (const [txKey, transaction] of alive) {
      const remainder = Number(transaction.amountMinor) - (allocatedByTx.get(txKey) ?? 0);
      if (remainder <= 0) continue;
      for (const itemKey of itemsByTx.get(txKey) ?? []) {
        contextOf(itemKey).unallocatedMinor += remainder;
      }
    }
  }

  /** 批量取配件批次并按 itemId 归组，避免列表页 N+1。 */
  async accessoriesByItem(itemIds: IdBytes[]): Promise<Map<string, ItemAccessory[]>> {
    const grouped = new Map<string, ItemAccessory[]>();
    if (itemIds.length === 0) return grouped;

    const rows = await this.prisma.itemAccessory.findMany({
      where: { itemId: { in: itemIds }, deletedAt: null },
      orderBy: [{ purchasedAt: 'asc' }, { id: 'asc' }],
    });
    for (const row of rows) {
      const key = bytesToUuid(row.itemId);
      const bucket = grouped.get(key);
      if (bucket) bucket.push(row);
      else grouped.set(key, [row]);
    }
    return grouped;
  }

  metricsOf(item: Item, context: ItemCostContext): ItemCostSummary {
    return costMetricsOf({
      purchasePriceMinor: Number(item.purchasePriceMinor),
      purchaseDate: item.purchaseDate,
      expectedLifespanDays: item.expectedLifespanDays,
      accessories: context.accessories.map((row) => ({
        unitPriceMinor: Number(row.unitPriceMinor),
        firstUnitExtraMinor: Number(row.firstUnitExtraMinor ?? 0n),
        totalQty: row.totalQty,
        usedQty: row.usedQty + row.revertedQty,
      })),
      allocations: context.allocations,
      unallocatedMinor: context.unallocatedMinor,
    });
  }

  /**
   * 成本演进台阶（详情页折线）：按日聚合「本体 / 附加费用 / 配件消耗」三类增量后累加。
   * 本体由分摊承载时不再用回退价起步，而是让分摊自己抬升（同日自动合并为一点）。
   */
  timelineOf(item: Item, context: ItemCostContext, usages: UsageDelta[]): CostPointDto[] {
    const unitPrice = new Map(context.accessories.map((row) => [bytesToUuid(row.id), Number(row.unitPriceMinor)]));
    const firstExtra = new Map(context.accessories.map((row) => [bytesToUuid(row.id), Number(row.firstUnitExtraMinor ?? 0n)]));
    const usedByAccessory = new Map<string, number>();
    const perDay = new Map<string, number>();
    const add = (date: Date, delta: number): void => {
      const key = dayKey(date);
      perDay.set(key, (perDay.get(key) ?? 0) + delta);
    };

    const purchaseDay = toDateOnlyString(item.purchaseDate);
    if (context.allocations.bodyMinor > 0) {
      // 只是为了让折线从购买日开始；真正的金额由同日合并的本体分摊给出
      perDay.set(purchaseDay, 0);
    } else {
      perDay.set(purchaseDay, Number(item.purchasePriceMinor));
    }
    for (const event of context.events) add(event.occurredAt, event.amountMinor);
    for (const usage of usages) {
      const key = bytesToUuid(usage.accessoryId);
      const before = usedByAccessory.get(key) ?? 0;
      const after = before + usage.deltaQty;
      add(usage.createdAt, usage.deltaQty * (unitPrice.get(key) ?? 0));
      if (before === 0 && after > 0) add(usage.createdAt, firstExtra.get(key) ?? 0);
      if (before > 0 && after === 0) add(usage.createdAt, -(firstExtra.get(key) ?? 0));
      usedByAccessory.set(key, after);
    }

    const points: CostPointDto[] = [];
    let cumulative = 0;
    for (const date of [...perDay.keys()].sort()) {
      cumulative += perDay.get(date) ?? 0;
      points.push({ date, holdCostMinor: cumulative });
    }

    const today = toDateOnlyString(new Date());
    const last = points[points.length - 1];
    if (last && last.date < today) points.push({ date: today, holdCostMinor: cumulative });
    return points;
  }
}
