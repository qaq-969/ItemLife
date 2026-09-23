/**
 * 物品成本指标（设计报告 8.2）：以「物品本体价 + 配件批次」为唯一数据源，
 * 不重复累加流水金额（流水仅用于展示与对账）。前后端共用同一套公式，避免口径漂移。
 */

/** 参与计算的配件批次：单价 × 总数 / 已用数（金额单位：分）。 */
export interface CostAccessoryInput {
  unitPriceMinor: number;
  totalQty: number;
  usedQty: number;
}

/** 三核心 + 两辅助指标的原始值。 */
export interface CostMetrics {
  /** ① 总支付金额 = 本体价 + Σ(配件单价 × 总数) */
  payTotalMinor: number;
  /** ② 当前持有成本 = 本体价 + Σ(配件单价 × 已用数) */
  holdCostMinor: number;
  /** ③ 日均持有成本 = 持有成本 ÷ 持有天数（四舍五入到分） */
  dailyHoldCostMinor: number;
  /** 持有天数 = 今天 − 购买日 + 1（至少 1 天） */
  heldDays: number;
  /** ④ 剩余库存价值 = Σ(配件单价 × (总数 − 已用数)) */
  remainingStockMinor: number;
  /** ⑤ 预计日均成本 = 总支付 ÷ 预期寿命天数；未填预期寿命时为 null */
  projectedDailyMinor: number | null;
}

/** 持有天数：购买当天算 1 天，未来日期按 1 天兜底。 */
export function heldDaysOf(purchaseDate: Date | string, today: Date = new Date()): number {
  const start = startOfUtcDay(purchaseDate);
  const end = startOfUtcDay(today);
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return days >= 1 ? days : 1;
}

/** 依据 8.2 公式计算全部成本指标。 */
export function costMetricsOf(input: {
  purchasePriceMinor: number;
  purchaseDate: Date | string;
  expectedLifespanDays?: number | null;
  accessories: CostAccessoryInput[];
  today?: Date;
}): CostMetrics {
  const paidForAccessories = input.accessories.reduce(
    (sum, item) => sum + item.unitPriceMinor * item.totalQty,
    0,
  );
  const usedAccessories = input.accessories.reduce(
    (sum, item) => sum + item.unitPriceMinor * item.usedQty,
    0,
  );
  const remainingStockMinor = paidForAccessories - usedAccessories;

  const payTotalMinor = input.purchasePriceMinor + paidForAccessories;
  const holdCostMinor = input.purchasePriceMinor + usedAccessories;
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
  };
}

function startOfUtcDay(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
