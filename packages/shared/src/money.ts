/**
 * 金额工具：全库以「分」为最小单位（BIGINT），杜绝浮点误差。
 * 所有用户输入 / 展示的换算必须经过本模块。
 */

const YUAN_PATTERN = /^-?\d+(\.\d{1,2})?$/;

/** 把「元」字符串 / 数字安全转换为「分」整数；非法输入抛错。 */
export function toMinor(yuan: string | number): number {
  const text = typeof yuan === 'number' ? yuan.toFixed(2) : yuan.trim();
  if (!YUAN_PATTERN.test(text)) {
    throw new Error(`非法金额：${yuan}（最多两位小数）`);
  }
  const negative = text.startsWith('-');
  const [intPart = '0', decPart = ''] = text.replace('-', '').split('.');
  const minor = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`金额超出安全范围：${yuan}`);
  }
  return negative ? -minor : minor;
}

/** 把「分」整数格式化为「元」字符串（两位小数，无千分位）。 */
export function toYuan(minor: number): string {
  if (!Number.isInteger(minor)) {
    throw new Error(`分值必须为整数：${minor}`);
  }
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** 展示用：带千分位与货币符号，如 ¥1,234.56。 */
export function formatMoney(minor: number, currency = 'CNY'): string {
  const symbol = currency === 'CNY' ? '¥' : `${currency} `;
  const [intPart, decPart] = toYuan(minor).replace('-', '').split('.');
  const grouped = (intPart ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${minor < 0 ? '-' : ''}${symbol}${grouped}.${decPart}`;
}

/** 分摊校验：Σ分摊金额 ≤ 流水金额（差额为「未分摊」）。 */
export function isAllocationValid(
  amountMinor: number,
  allocations: Array<{ amountMinor: number | null }>,
): boolean {
  const sum = allocations.reduce((acc, a) => acc + (a.amountMinor ?? 0), 0);
  return sum <= amountMinor;
}

/** 单利按日计息：本金（分）× 年化基点 ÷ 10000 ÷ 365 × 天数，四舍五入到分。 */
export function dailyInterestMinor(
  balanceMinor: number,
  annualRateBp: number,
  days: number,
): number {
  const raw = (balanceMinor * annualRateBp * days) / (10_000 * 365);
  return Math.round(raw);
}

/**
 * 结息口径（设计报告 8.5）：Σ(每日余额 × 年化 ÷ 365)。
 * dailyBalanceSumMinor 为区间内每日日终余额之和（分），避免逐日浮点累加。
 */
export function interestFromDailySum(dailyBalanceSumMinor: number, annualRateBp: number): number {
  return Math.round((dailyBalanceSumMinor * annualRateBp) / (10_000 * 365));
}
