/**
 * 物品成本指标（设计报告 8.2）：以「流水分摊（body/fee/accessory） + 配件批次」为数据源，
 * 前后端共用同一套公式，避免口径漂移。
 *
 * 联动调整后本体价的来源改变（方案 §5.2）：优先取 Σ(body+fee 分摊)，没有分摊时回退到
 * 录入时手填的 purchasePriceMinor（回退价）。公式本身不变 —— 因为 body/fee 全额立即计入、
 * accessory 未用部分挂库存，恒等式「持有成本 = 总支付 − 剩余库存」在所有场景下成立。
 */

/** 参与计算的配件批次：单价 × 总数 / 已用数（金额单位：分）。 */
export interface CostAccessoryInput {
  unitPriceMinor: number;
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

/** 依据 8.2 公式计算全部成本指标。 */
export function costMetricsOf(input: {
  /** 回退价：无 body/fee 分摊时启用 */
  purchasePriceMinor: number;
  /** Σ(body + fee 分摊)；有值时覆盖回退价，无值时回退 */
  allocatedBaseMinor?: number | null;
  purchaseDate: Date | string;
  expectedLifespanDays?: number | null;
  accessories: CostAccessoryInput[];
  /** 关联流水未分摊金额，仅原样带出（不计入任何指标） */
  unallocatedMinor?: number;
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

  const base = input.allocatedBaseMinor && input.allocatedBaseMinor > 0
    ? input.allocatedBaseMinor
    : input.purchasePriceMinor;

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
