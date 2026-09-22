/** 日志脱敏工具：审计日志中不落完整邮箱 / 令牌 */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return '***';
  return `${name?.slice(0, 1) ?? ''}***@${domain}`;
}

export function maskToken(token: string): string {
  return token.length <= 8 ? '***' : `${token.slice(0, 4)}***${token.slice(-4)}`;
}
