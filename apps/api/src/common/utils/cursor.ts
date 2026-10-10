/**
 * 游标分页编解码：游标对前端不透明，内含排序键（设计报告 8.2 游标分页）。
 * 键集分页（keyset）优于 offset：翻页不随数据写入而漂移。
 */
export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | undefined | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 解析分页参数：limit 默认 20、上限 100。 */
export function parseLimit(raw: string | number | undefined, fallback = 20, max = 100): number {
  const value = typeof raw === 'number' ? raw : Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}
