export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordStrength {
  ok: boolean;
  issues: string[];
}

/** 与设计报告 FR-01 一致：≥10 位，且同时包含大小写字母、数字与符号。 */
export function checkPasswordStrength(password: string): PasswordStrength {
  const issues: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    issues.push(`长度至少 ${PASSWORD_MIN_LENGTH} 位`);
  }
  if (!/[a-z]/.test(password)) issues.push('需包含小写字母');
  if (!/[A-Z]/.test(password)) issues.push('需包含大写字母');
  if (!/\d/.test(password)) issues.push('需包含数字');
  if (!/[^A-Za-z0-9]/.test(password)) issues.push('需包含符号');
  return { ok: issues.length === 0, issues };
}
