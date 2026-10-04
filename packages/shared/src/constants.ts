/** 领域常量：前后端共用，避免魔法字符串散落。 */

export const OWNER_TYPES = ['user', 'household'] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export const TRANSACTION_TYPES = ['income', 'expense', 'transfer_in', 'transfer_out'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const ACCOUNT_TYPES = ['cash', 'bank', 'payment', 'investment', 'receivable', 'payable'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const INTEREST_FREQS = ['monthly', 'quarterly', 'yearly'] as const;
export type InterestFreq = (typeof INTEREST_FREQS)[number];

/** 结息周期的月数：用于判断「距上次结息是否满一个周期」。 */
export const INTEREST_FREQ_MONTHS: Record<InterestFreq, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

export const CATEGORY_KINDS = ['expense', 'income'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const ITEM_STATUSES = ['in_use', 'idle', 'retired', 'lost'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/**
 * 分摊角色：决定这笔钱如何进入物品成本（设计报告联动调整方案 5.4）。
 * - body      本体采购：全额计入总支付与持有成本
 * - fee       附加费用（维修 / 运费 / 保险）：同本体，全额计入
 * - accessory 配件采购：计总支付，未使用部分挂库存、已用部分进持有成本
 * - link      仅关联：纯溯源，不进任何成本口径
 */
export const ALLOCATION_ROLES = ['body', 'fee', 'accessory', 'link'] as const;
export type AllocationRole = (typeof ALLOCATION_ROLES)[number];

/** 进总支付的两种角色（本体 + 附加费用），金额与本体价同口径。 */
export const ITEM_COST_ROLES = ['body', 'fee'] as const satisfies readonly AllocationRole[];

export const HOUSEHOLD_ROLES = ['owner', 'admin', 'member'] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

export const SITE_ROLES = ['super_admin', 'admin', 'user'] as const;
export type SiteRole = (typeof SITE_ROLES)[number];

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
