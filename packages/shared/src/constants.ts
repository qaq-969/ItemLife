/** 领域常量：前后端共用，避免魔法字符串散落。 */

export const OWNER_TYPES = ['user', 'household'] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export const TRANSACTION_TYPES = ['income', 'expense', 'transfer_in', 'transfer_out'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const ACCOUNT_TYPES = ['cash', 'bank', 'payment', 'investment', 'receivable', 'payable'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const INTEREST_FREQS = ['monthly', 'quarterly', 'yearly'] as const;
export type InterestFreq = (typeof INTEREST_FREQS)[number];

export const ITEM_STATUSES = ['in_use', 'idle', 'retired', 'lost'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const HOUSEHOLD_ROLES = ['owner', 'member'] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

/** 系统标签：驱动看板「收益」口径与自动结息流水识别。 */
export const SYSTEM_TAGS = {
  investmentReturn: 'investment_return',
  interest: 'interest',
} as const;
export type SystemTag = (typeof SYSTEM_TAGS)[keyof typeof SYSTEM_TAGS];

export const DEFAULT_CURRENCY = 'CNY';
export const SUPPORTED_CURRENCIES = ['CNY'] as const;

/** 项目固定常量 */
export const MONEY_MINOR_UNIT = 'cent' as const;
export const REFRESH_COOKIE_NAME = 'il_refresh_token';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 14;
export const INVITE_CODE_TTL_HOURS = 72;
export const INVITE_CODE_MAX_USES = 5;
export const RECOVERY_CODE_COUNT = 10;
export const API_PREFIX = 'api/v1';
