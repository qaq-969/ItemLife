import { ApiProperty } from '@nestjs/swagger';
import type { AccessoryUsage, Item, ItemAccessory } from '@prisma/client';
import {
  ITEM_STATUSES,
  type AccessoryDto,
  type AccessoryUsageDto,
  type CategoryBrief,
  type CostPointDto,
  type ItemCostSummary,
  type InventoryRevertDto,
  type ItemDetailDto,
  type ItemDto,
  type ItemsOverviewDto,
  type ItemStatus,
  type OwnerRef,
} from '@itemlife/shared';
import { toDateOnlyString } from '../../../common/utils/date';
import { bytesToUuid } from '../../../common/utils/id';
import { TransactionVo } from '../../transactions/dto/transaction.vo';

/** 与 Prisma 行解耦：只要求这几个字段，便于服务层注入分类 / 分类快照。 */
export interface ItemExtras {
  category?: CategoryBrief | null;
  accessoryCount?: number;
}

export class ItemVo implements ItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: { type: 'user', id: '0191…' } })
  owner!: OwnerRef;

  @ApiProperty({ example: '电动牙刷' })
  name!: string;

  @ApiProperty({ example: '2026-06-11' })
  purchaseDate!: string;

  @ApiProperty({ description: '本体价（分）' })
  purchasePriceMinor!: number;

  @ApiProperty({ nullable: true })
  expectedLifespanDays!: number | null;

  @ApiProperty({ enum: ITEM_STATUSES })
  status!: ItemStatus;

  @ApiProperty({ example: 'CNY' })
  currency!: string;

  @ApiProperty({ nullable: true })
  categoryId!: string | null;

  @ApiProperty({ nullable: true })
  category!: CategoryBrief | null;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ description: '配件批次数' })
  accessoryCount!: number;

  @ApiProperty({ description: '三核心 + 两辅助成本指标（分），公式见设计报告 8.2' })
  cost!: ItemCostSummary;

  @ApiProperty()
  createdAt!: string;

  static from(row: Item, cost: ItemCostSummary, extras: ItemExtras = {}): ItemVo {
    const vo = new ItemVo();
    vo.id = bytesToUuid(row.id);
    vo.owner = { type: row.ownerType, id: bytesToUuid(row.ownerId) };
    vo.name = row.name;
    vo.purchaseDate = toDateOnlyString(row.purchaseDate);
    vo.purchasePriceMinor = Number(row.purchasePriceMinor);
    vo.expectedLifespanDays = row.expectedLifespanDays;
    vo.status = row.status as ItemStatus;
    vo.currency = row.currency;
    vo.categoryId = row.categoryId ? bytesToUuid(row.categoryId) : null;
    vo.category = extras.category ?? null;
    vo.note = row.note;
    vo.accessoryCount = extras.accessoryCount ?? 0;
    vo.cost = cost;
    vo.createdAt = row.createdAt.toISOString();
    return vo;
  }
}

export class AccessoryVo implements AccessoryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  itemId!: string;

  @ApiProperty({ example: '替换刷头' })
  name!: string;

  @ApiProperty({ description: '单价（分）' })
  unitPriceMinor!: number;

  @ApiProperty({ description: '第一件配件额外分摊的余数（分）' })
  firstUnitExtraMinor!: number;

  @ApiProperty()
  totalQty!: number;

  @ApiProperty()
  usedQty!: number;

  @ApiProperty({ description: '已撤销的库存数量' })
  revertedQty!: number;

  @ApiProperty({ description: '剩余 = totalQty − usedQty − revertedQty' })
  remainingQty!: number;

  @ApiProperty({ example: '2026-06-11' })
  purchasedAt!: string;

  @ApiProperty({ nullable: true })
  transactionId!: string | null;

  @ApiProperty()
  createdAt!: string;

  static from(row: ItemAccessory): AccessoryVo {
    const vo = new AccessoryVo();
    vo.id = bytesToUuid(row.id);
    vo.itemId = bytesToUuid(row.itemId);
    vo.name = row.name;
    vo.unitPriceMinor = Number(row.unitPriceMinor);
    vo.firstUnitExtraMinor = Number(row.firstUnitExtraMinor);
    vo.totalQty = row.totalQty;
    vo.usedQty = row.usedQty;
    vo.revertedQty = row.revertedQty;
    vo.remainingQty = row.totalQty - row.usedQty - row.revertedQty;
    vo.purchasedAt = toDateOnlyString(row.purchasedAt);
    vo.transactionId = row.transactionId ? bytesToUuid(row.transactionId) : null;
    vo.createdAt = row.createdAt.toISOString();
    return vo;
  }
}

export class AccessoryUsageVo implements AccessoryUsageDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  accessoryId!: string;

  @ApiProperty({ example: '替换刷头' })
  accessoryName!: string;

  @ApiProperty({ description: '正数为消耗、负数为撤销' })
  deltaQty!: number;

  @ApiProperty({ description: '本次变更后的已用数量' })
  usedQtyAfter!: number;

  @ApiProperty({ nullable: true })
  actorUserId!: string | null;

  @ApiProperty({ nullable: true })
  actorName!: string | null;

  @ApiProperty()
  createdAt!: string;

  static from(row: AccessoryUsage, accessoryName: string, actorName: string | null): AccessoryUsageVo {
    const vo = new AccessoryUsageVo();
    vo.id = bytesToUuid(row.id);
    vo.accessoryId = bytesToUuid(row.accessoryId);
    vo.accessoryName = accessoryName;
    vo.deltaQty = row.deltaQty;
    vo.usedQtyAfter = row.usedQtyAfter;
    vo.actorUserId = row.actorUserId ? bytesToUuid(row.actorUserId) : null;
    vo.actorName = actorName;
    vo.createdAt = row.createdAt.toISOString();
    return vo;
  }
}

export class ItemDetailVo extends ItemVo implements ItemDetailDto {
  @ApiProperty({ type: [AccessoryVo] })
  accessories!: AccessoryVo[];

  @ApiProperty({ type: [AccessoryUsageVo], description: '消耗 / 撤销审计记录，最近在前' })
  usages!: AccessoryUsageVo[];

  @ApiProperty({ type: [Object] })
  reverts!: InventoryRevertDto[];

  @ApiProperty({ type: [Object], description: '成本演进台阶：{ date, holdCostMinor }' })
  costTimeline!: CostPointDto[];

  @ApiProperty({ type: [TransactionVo], description: '分摊了本物品的流水' })
  transactions!: TransactionVo[];

  static detail(
    base: ItemVo,
    extra: {
      accessories: AccessoryVo[];
      usages: AccessoryUsageVo[];
      reverts: InventoryRevertDto[];
      costTimeline: CostPointDto[];
      transactions: TransactionVo[];
    },
  ): ItemDetailVo {
    return Object.assign(new ItemDetailVo(), base, extra);
  }
}

export class ItemsOverviewVo implements ItemsOverviewDto {
  @ApiProperty({ description: '总支付金额（分）：Σ 本体价 + Σ 配件总额' })
  payTotalMinor!: number;

  @ApiProperty({ description: '当前持有成本（分）：Σ 本体价 + Σ 已用配件' })
  holdCostMinor!: number;

  @ApiProperty({ description: '配件库存价值（分）：Σ 未使用配件' })
  remainingStockMinor!: number;

  @ApiProperty()
  itemCount!: number;

  @ApiProperty({ description: '在役物品数（status=in_use）' })
  inUseCount!: number;

  @ApiProperty({ type: [ItemVo], description: '按日均持有成本倒序的前 5 项' })
  topCostly!: ItemVo[];

  static from(data: ItemsOverviewDto): ItemsOverviewVo {
    return Object.assign(new ItemsOverviewVo(), data);
  }
}
