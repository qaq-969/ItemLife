/**
 * 日期工具：全库时间统一 UTC（设计报告 5.1）。
 * 结息按「自然日」结算，故一律使用 UTC 零点作为日边界；DATE 列（如 interest_posted_at）同样以 UTC 日期存储。
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function startOfDayUtc(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function addDaysUtc(value: Date, days: number): Date {
  return new Date(startOfDayUtc(value).getTime() + days * 86_400_000);
}

export function addMonthsUtc(value: Date, months: number): Date {
  const base = startOfDayUtc(value);
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + months;
  const day = base.getUTCDate();
  // 月末溢出（如 1/31 + 1 月）会被 Date 归一化到 3/2，这里回退到目标月最后一天
  const candidate = new Date(Date.UTC(year, month, day));
  if (candidate.getUTCDate() !== day) return new Date(Date.UTC(year, month + 1, 0));
  return candidate;
}

/** `YYYY-MM-DD` → UTC 零点；非法输入返回 null 由调用方返回 400。 */
export function parseDateOnly(value: string | undefined | null): Date | null {
  if (!value) return null;
  const text = value.slice(0, 10);
  if (!DATE_ONLY.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** UTC 日期键，用于按自然日分桶。 */
export function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** 两个 UTC 日的整数天差。 */
export function daysBetweenUtc(from: Date, to: Date): number {
  return Math.round((startOfDayUtc(to).getTime() - startOfDayUtc(from).getTime()) / 86_400_000);
}

/** 序列化为 `YYYY-MM-DD`（DATE 列与结息区间展示用）。 */
export function toDateOnlyString(value: Date): string {
  return startOfDayUtc(value).toISOString().slice(0, 10);
}
