import type {
  AccountDto,
  AccountSummaryDto,
  AccountType,
  CategoryDto,
  CategoryKind,
  InterestFreq,
  InterestRunResult,
  Paginated,
  TransactionDto,
  TransactionSummaryDto,
  TransactionType,
} from '@itemlife/shared';
import { http, unwrap } from './http';

/** 归属数据域：省略即个人；家庭由后续里程碑的界面选择。 */
export interface OwnerBody {
  type?: 'user' | 'household';
  id?: string;
}

/* ---------- 账户 ---------- */

export interface AccountPayload {
  name: string;
  type: AccountType;
  initialBalanceMinor?: number;
  /** 年化基点（1bp = 0.01%），与 interestFreq 成对出现 */
  interestRateBp?: number;
  interestFreq?: InterestFreq;
  owner?: OwnerBody;
}

/** 计息字段传 null 表示关闭计息（服务端会同时清空周期）。 */
export interface AccountPatch {
  name?: string;
  type?: AccountType;
  /** null = 关闭计息 */
  interestRateBp?: number | null;
  interestFreq?: InterestFreq | null;
  sortOrder?: number;
}

export interface CategoryPayload {
  kind: CategoryKind;
  name: string;
  parentId?: string;
  icon?: string;
  color?: string;
  sortOrder?: number;
  owner?: OwnerBody;
}

export interface CategoryPatch {
  name?: string;
  icon?: string;
  color?: string;
  parentId?: string | null;
  sortOrder?: number;
  archived?: boolean;
}

/** 排序落库项：一次请求完成同级排序与跨组移动。 */
export interface CategoryOrderItem {
  id: string;
  sortOrder: number;
  parentId?: string | null;
}

export interface TransactionAllocation {
  itemId: string;
  /** null = 继承整笔金额（仅单物品时允许） */
  amountMinor?: number | null;
}

export interface TransactionPayload {
  type: TransactionType;
  amountMinor: number;
  accountId?: string;
  toAccountId?: string;
  categoryId?: string;
  occurredAt?: string;
  note?: string;
  items?: TransactionAllocation[];
  owner?: OwnerBody;
}

export interface TransactionPatch {
  amountMinor?: number;
  accountId?: string;
  categoryId?: string | null;
  occurredAt?: string;
  note?: string | null;
  items?: TransactionAllocation[];
}

export interface TransactionQuery {
  domain?: string;
  type?: TransactionType;
  accountId?: string;
  categoryId?: string;
  /** YYYY-MM-DD（含） */
  from?: string;
  /** YYYY-MM-DD（含） */
  to?: string;
  keyword?: string;
  cursor?: string;
  limit?: number;
}

export interface SummaryQuery {
  from: string;
  to: string;
  domain?: string;
  accountId?: string;
}

export const accountsApi = {
  list: (params: { domain?: string } = {}) => unwrap<AccountDto[]>(http.get('/accounts', { params })),
  summary: (params: { domain?: string } = {}) =>
    unwrap<AccountSummaryDto>(http.get('/accounts/summary', { params })),
  create: (payload: AccountPayload) => unwrap<AccountDto>(http.post('/accounts', payload)),
  update: (id: string, payload: AccountPatch) => unwrap<AccountDto>(http.patch(`/accounts/${id}`, payload)),
  remove: (id: string) => unwrap<null>(http.delete(`/accounts/${id}`)),
};

export const categoriesApi = {
  list: (params: { kind?: CategoryKind; domain?: string; includeArchived?: boolean } = {}) =>
    unwrap<CategoryDto[]>(http.get('/categories', { params })),
  create: (payload: CategoryPayload) => unwrap<CategoryDto>(http.post('/categories', payload)),
  update: (id: string, payload: CategoryPatch) =>
    unwrap<CategoryDto>(http.patch(`/categories/${id}`, payload)),
  remove: (id: string) => unwrap<null>(http.delete(`/categories/${id}`)),
  reorder: (items: CategoryOrderItem[], owner?: OwnerBody) =>
    unwrap<CategoryDto[]>(http.put('/categories/order', { items, ...(owner ? { owner } : {}) })),
};

export const transactionsApi = {
  list: (params: TransactionQuery = {}) =>
    unwrap<Paginated<TransactionDto>>(http.get('/transactions', { params })),
  summary: (params: SummaryQuery) =>
    unwrap<TransactionSummaryDto>(http.get('/transactions/summary', { params })),
  /** Idempotency-Key 由调用方生成并复用，避免重复提交产生两条流水 */
  create: (payload: TransactionPayload, idempotencyKey?: string) =>
    unwrap<TransactionDto>(
      http.post('/transactions', payload, {
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      }),
    ),
  update: (id: string, payload: TransactionPatch) =>
    unwrap<TransactionDto>(http.patch(`/transactions/${id}`, payload)),
  remove: (id: string) => unwrap<null>(http.delete(`/transactions/${id}`)),
};

export const interestApi = {
  /** 只算不入账：返回每个计息账户 [上次结息日+1, 今天] 的应计利息 */
  preview: (params: { domain?: string; accountId?: string } = {}) =>
    unwrap<InterestRunResult[]>(http.get('/interest/preview', { params })),
  post: (accountId: string) => unwrap<InterestRunResult>(http.post('/interest/post', { accountId })),
  /** 立即结算所有到期账户（自动任务每日 02:30 也会跑一次） */
  run: () => unwrap<InterestRunResult[]>(http.post('/interest/run', null)),
};
