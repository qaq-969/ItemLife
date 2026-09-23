import type {
  AccountType,
  CategoryKind,
  InterestFreq,
  ItemStatus,
  TransactionType,
} from './constants';

/** 数据归属：个人或某个家庭。 */
export interface OwnerRef {
  type: 'user' | 'household';
  id: string;
}

/** 分页响应包络（游标分页）。 */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

/** 统一响应包络：{ code: 0, message: 'ok', data }，错误时 code 为业务错误码且 HTTP 状态同步语义。 */
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/** 物品成本三核心指标 + 辅助指标（金额单位：分）。 */
export interface ItemCostSummary {
  payTotalMinor: number;
  holdCostMinor: number;
  dailyHoldCostMinor: number;
  heldDays: number;
  remainingStockMinor: number;
  projectedDailyMinor: number | null;
}

/** 记一笔时的物品分摊项：amountMinor = null 表示继承整笔流水金额（仅单物品）。 */
export interface TransactionItemAllocation {
  itemId: string;
  amountMinor: number | null;
}

/** 流水里的账户快照：列表页直接展示名称，免去前端二次映射。 */
export interface AccountBrief {
  id: string;
  name: string;
  type: AccountType;
}

/** 流水里的分类快照。 */
export interface CategoryBrief {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

/** 流水列表项。 */
export interface TransactionDto {
  id: string;
  owner: OwnerRef;
  type: TransactionType;
  amountMinor: number;
  currency: string;
  accountId: string;
  account: AccountBrief;
  categoryId: string | null;
  category: CategoryBrief | null;
  occurredAt: string;
  note: string | null;
  systemTag: string | null;
  /** 转账成对写入时共享的组 ID；非转账为 null */
  transferGroupId: string | null;
  items: TransactionItemAllocation[];
  createdAt: string;
}

/** 分类（树形：顶层带 children，最多两级）。 */
export interface CategoryDto {
  id: string;
  owner: OwnerRef;
  kind: CategoryKind;
  name: string;
  icon: string | null;
  color: string | null;
  parentId: string | null;
  sortOrder: number;
  systemTag: string | null;
  isSystem: boolean;
  archivedAt: string | null;
  children: CategoryDto[];
}

/** 区间收支小计（金额单位：分）。 */
export interface TransactionSummaryDto {
  from: string;
  to: string;
  incomeMinor: number;
  expenseMinor: number;
  /** 结余 = 收入 − 支出 */
  netMinor: number;
}

/** 利息结算结果：preview 为 true 时只算不入账。 */
export interface InterestRunResult {
  accountId: string;
  accountName: string;
  /** 计息区间首日（含），YYYY-MM-DD */
  from: string;
  /** 计息区间末日（含），YYYY-MM-DD */
  to: string;
  days: number;
  averageBalanceMinor: number;
  interestMinor: number;
  /** 计息周期是否已满：未满只能预览，自动结息不会落账 */
  due: boolean;
  /** 下一个满周期日，YYYY-MM-DD */
  nextDueAt: string;
  preview: boolean;
  transactionId: string | null;
}

/** 账户（含计息配置与派生余额）。 */
export interface AccountDto {
  id: string;
  owner: OwnerRef;
  name: string;
  type: AccountType;
  currency: string;
  initialBalanceMinor: number;
  /** 派生余额 = 初始 + Σ收入 − Σ支出 + Σ转入 − Σ转出（软删流水不计入） */
  balanceMinor: number;
  interestRateBp: number | null;
  interestFreq: InterestFreq | null;
  interestPostedAt: string | null;
  sortOrder: number;
}

/** 账户余额汇总（按账户类型分组）。 */
export interface AccountSummaryDto {
  totalMinor: number;
  byType: Array<{ type: AccountType; totalMinor: number; count: number }>;
}

/** 物品（含成本摘要）。 */
export interface ItemDto {
  id: string;
  owner: OwnerRef;
  name: string;
  purchaseDate: string;
  purchasePriceMinor: number;
  expectedLifespanDays: number | null;
  status: ItemStatus;
  currency: string;
  cost: ItemCostSummary;
}
