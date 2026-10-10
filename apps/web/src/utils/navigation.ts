/** 只接受站内绝对路径，避免开放重定向 */
export function safeRedirect(value: unknown): string | null {
  const raw = typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : null;
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}
