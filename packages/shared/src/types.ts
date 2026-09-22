import type {
  AccountType,
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

/** 流水列表项（骨架阶段的最小字段集）。 */
export interface TransactionDto {
  id: string;
  owner: OwnerRef;
  type: TransactionType;
  amountMinor: number;
  currency: string;
  accountId: string;
  categoryId: string | null;
  occurredAt: string;
  note: string | null;
  systemTag: string | null;
  items: TransactionItemAllocation[];
}

/** 账户（含计息配置）。 */
export interface AccountDto {
  id: string;
  owner: OwnerRef;
  name: string;
  type: AccountType;
  currency: string;
  initialBalanceMinor: number;
  balanceMinor: number;
  interestRateBp: number | null;
  interestFreq: InterestFreq | null;
  interestPostedAt: string | null;
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
