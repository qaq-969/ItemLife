import { Injectable } from '@nestjs/common';
import type { Item, ItemAccessory } from '@prisma/client';
import { costMetricsOf, type CostPointDto, type ItemCostSummary } from '@itemlife/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { dayKey, toDateOnlyString } from '../../common/utils/date';
import { bytesToUuid, type IdBytes } from '../../common/utils/id';

/** 一次「使用 / 撤销」事件在成本演进上的输入。 */
export interface UsageDelta {
  accessoryId: IdBytes;
  deltaQty: number;
  createdAt: Date;
}

/**
 * 成本指标的唯一计算入口（设计报告 8.2）：公式本身在 @itemlife/shared，
 * 这里只负责批量取数与聚合，保证列表 / 详情 / 看板 / 前端共用同一口径。
 */
@Injectable()
export class CostService {
  constructor(private readonly prisma: PrismaService) {}

  /** 批量取配件批次并按 itemId 归组，避免列表页 N+1。 */
  async accessoriesByItem(itemIds: IdBytes[]): Promise<Map<string, ItemAccessory[]>> {
    const grouped = new Map<string, ItemAccessory[]>();
    if (itemIds.length === 0) return grouped;

    const rows = await this.prisma.itemAccessory.findMany({
      where: { itemId: { in: itemIds } },
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

  metricsOf(item: Item, accessories: ItemAccessory[]): ItemCostSummary {
    return costMetricsOf({
      purchasePriceMinor: Number(item.purchasePriceMinor),
      purchaseDate: item.purchaseDate,
      expectedLifespanDays: item.expectedLifespanDays,
      accessories: accessories.map((row) => ({
        unitPriceMinor: Number(row.unitPriceMinor),
        totalQty: row.totalQty,
        usedQty: row.usedQty,
      })),
    });
  }

  /**
   * 成本演进台阶（详情页折线）：购买日以本体价起步，之后每次配件消耗按批次单价累加，
   * 撤销则回落；同日多次变更合并为一点，最后补一个「今天」的点让折线延伸到当前。
   */
  timelineOf(item: Item, accessories: ItemAccessory[], usages: UsageDelta[]): CostPointDto[] {
    const unitPrice = new Map(accessories.map((row) => [bytesToUuid(row.id), Number(row.unitPriceMinor)]));
    const perDay = new Map<string, number>();
    for (const usage of usages) {
      const price = unitPrice.get(bytesToUuid(usage.accessoryId)) ?? 0;
      const key = dayKey(usage.createdAt);
      perDay.set(key, (perDay.get(key) ?? 0) + usage.deltaQty * price);
    }

    const purchasePriceMinor = Number(item.purchasePriceMinor);
    const points: CostPointDto[] = [
      { date: toDateOnlyString(item.purchaseDate), holdCostMinor: purchasePriceMinor },
    ];
    let cumulative = purchasePriceMinor;
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
