/**
 * 物品成本指标（设计报告 8.2）：以「流水分摊（body/fee/accessory） + 配件批次」为数据源，
 * 前后端共用同一套公式，避免口径漂移。
 *
 * 联动调整后本体价的来源改变（方案 §5.2）：有 body 分摊时取 Σbody 覆盖录入时手填的
 * purchasePriceMinor（回退价），fee 恒为叠加项。公式本身不变 —— 因为 body/fee 全额立即计入、
 * accessory 未用部分挂库存，恒等式「持有成本 = 总支付 − 剩余库存」在所有场景下成立。
 */

/** 参与计算的配件批次：单价 × 总数 / 已用数（金额单位：分）。 */
export interface CostAccessoryInput {
  unitPriceMinor: number;
  /** 金额除不尽时全部计入第一件；第一件被使用后才进入持有成本。 */
  firstUnitExtraMinor?: number;
  totalQty: number;
  usedQty: number;
}

/** 三核心 + 两辅助指标的原始值。 */
export interface CostMetrics {
  /** ① 总支付金额 = Σ(body+fee 分摊，回退本体价) + Σ(配件单价 × 总数) */
  payTotalMinor: number;
  /** ② 当前持有成本 = Σ(body+fee 分摊，回退本体价) + Σ(配件单价 × 已用数) */
  holdCostMinor: number;
  /** ③ 日均持有成本 = 持有成本 ÷ 持有天数（四舍五入到分） */
  dailyHoldCostMinor: number;
  /** 持有天数 = 今天 − 购买日 + 1（至少 1 天） */
  heldDays: number;
  /** ④ 剩余库存价值 = Σ(配件单价 × (总数 − 已用数)) */
  remainingStockMinor: number;
  /** ⑤ 预计日均成本 = 总支付 ÷ 预期寿命天数；未填预期寿命时为 null */
  projectedDailyMinor: number | null;
  /** ⑥ 关联流水里没归到任何物品的钱（流水金额 − Σ分摊）；仅详情页提示，不进任何口径 */
  unallocatedMinor: number;
}

/** 持有天数：购买当天算 1 天，未来日期按 1 天兜底。 */
export function heldDaysOf(purchaseDate: Date | string, today: Date = new Date()): number {
  const start = startOfUtcDay(purchaseDate);
  const end = startOfUtcDay(today);
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return days >= 1 ? days : 1;
}

/** Σ 各角色的流水分摊金额（分）。配件不在此列：它的钱走批次单价×数量。 */
export interface AllocationSums {
  bodyMinor: number;
  feeMinor: number;
}

/** 依据 8.2 公式计算全部成本指标。 */
export function costMetricsOf(input: {
  /** 录入时手填的本体价：仅在没有 body 分摊时才启用（回退价） */
  purchasePriceMinor: number;
  purchaseDate: Date | string;
  expectedLifespanDays?: number | null;
  accessories: CostAccessoryInput[];
  /** Σ(body + fee) 分摊；body 有值时覆盖回退价，fee 始终叠加 */
  allocations?: AllocationSums | null;
  /** 关联流水未分摊金额，仅原样带出（不计入任何指标） */
  unallocatedMinor?: number;
  today?: Date;
}): CostMetrics {
  const paidForAccessories = input.accessories.reduce(
    (sum, item) => sum + item.unitPriceMinor * item.totalQty + (item.firstUnitExtraMinor ?? 0),
    0,
  );
  const usedAccessories = input.accessories.reduce(
    (sum, item) => sum + item.unitPriceMinor * item.usedQty + (item.usedQty > 0 ? item.firstUnitExtraMinor ?? 0 : 0),
    0,
  );
  const remainingStockMinor = paidForAccessories - usedAccessories;

  const bodyMinor = input.allocations?.bodyMinor ?? 0;
  const feeMinor = input.allocations?.feeMinor ?? 0;
  const base = (bodyMinor > 0 ? bodyMinor : input.purchasePriceMinor) + feeMinor;

  const payTotalMinor = base + paidForAccessories;
  const holdCostMinor = base + usedAccessories;
  const heldDays = heldDaysOf(input.purchaseDate, input.today);

  return {
    payTotalMinor,
    holdCostMinor,
    dailyHoldCostMinor: Math.round(holdCostMinor / heldDays),
    heldDays,
    remainingStockMinor,
    projectedDailyMinor:
      input.expectedLifespanDays && input.expectedLifespanDays > 0
        ? Math.round(payTotalMinor / input.expectedLifespanDays)
        : null,
    unallocatedMinor: input.unallocatedMinor ?? 0,
  };
}

function startOfUtcDay(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
