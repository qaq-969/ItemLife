import type {
  AccountType,
  AllocationRole,
  CategoryKind,
  InterestFreq,
  ItemStatus,
  HouseholdRole,
  SiteRole,
  TransactionType,
} from './constants';

export interface SiteStatusDto {
  registrationOpen: boolean;
  initialized: boolean;
}

export interface SiteUserDto {
  id: string;
  email: string;
  nickname: string | null;
  inviteRemark: string | null;
  siteRole: SiteRole;
  disabledAt: string | null;
  createdAt: string;
}

export interface SiteInviteDto {
  id: string;
  remark: string | null;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdByEmail: string;
  code?: string;
}

export interface SiteAdminOverviewDto extends SiteStatusDto {
  users: SiteUserDto[];
  invites: SiteInviteDto[];
}

/** 数据归属：个人或某个家庭。 */
export interface OwnerRef {
  type: 'user' | 'household';
  id: string;
}

export interface HouseholdMemberDto {
  userId: string;
  email: string;
  nickname: string | null;
  role: HouseholdRole;
  joinedAt: string;
}

export interface HouseholdInviteDto {
  id: string;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  revokedAt: string | null;
  createdAt: string;
  /** 仅创建邀请的响应返回明文；列表永远不返回。 */
  code?: string;
}

export interface HouseholdDto {
  id: string;
  name: string;
  role: HouseholdRole;
  memberCount: number;
  createdAt: string;
}

export type DashboardGranularity = 'day' | 'week' | 'month';

export interface DashboardComparisonDto {
  currentMinor: number;
  previousMinor: number;
  changePercent: number | null;
}

export interface DashboardOverviewDto {
  from: string;
  to: string;
  expenseMinor: number;
  incomeMinor: number;
  savingMinor: number;
  returnMinor: number;
  netWorthMinor: number;
  expenseComparison: DashboardComparisonDto;
  savingComparison: DashboardComparisonDto;
  itemInvestment: Pick<ItemsOverviewDto, 'payTotalMinor' | 'holdCostMinor' | 'remainingStockMinor' | 'itemCount' | 'inUseCount'>;
}

export interface DashboardTrendPointDto {
  period: string;
  expenseMinor: number;
  incomeMinor: number;
  savingMinor: number;
  returnMinor: number;
  netWorthMinor: number;
}

export interface DashboardTrendDto {
  from: string;
  to: string;
  granularity: DashboardGranularity;
  points: DashboardTrendPointDto[];
}

export interface DashboardBreakdownDto {
  categories: Array<{ id: string | null; name: string; color: string | null; amountMinor: number; percent: number }>;
  accounts: Array<{ id: string; name: string; type: AccountType; balanceMinor: number; percent: number }>;
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
  /** 关联流水里没归到任何物品的钱；仅详情页提示 */
  unallocatedMinor: number;
}

/**
 * 记一笔时的物品分摊项：amountMinor = null 表示继承整笔流水金额（仅单物品）。
 * role 决定这笔钱如何进成本，默认 link（仅关联）。
 */
export interface TransactionItemAllocation {
  id: string;
  itemId: string;
  parentId: string | null;
  /** 当前显示名称：物品/配件取实时实体名，附加费用取行名称 */
  name: string;
  /** 归属物品的实时名称 */
  itemName: string;
  /** 物品已撤销时仍保留流水历史 */
  itemDeletedAt: string | null;
  amountMinor: number | null;
  role: AllocationRole;
  /** role = accessory 时指向具体批次 */
  accessoryId: string | null;
  /** 配件批次明细；非配件行均为 null/0 */
  quantity: number | null;
  unitPriceMinor: number | null;
  firstUnitExtraMinor: number;
  usedQty: number | null;
  revertedQty: number | null;
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
  categoryId: string | null;
  category: CategoryBrief | null;
  note: string | null;
  /** 配件批次数量（列表页提示用，不计入成本摘要） */
  accessoryCount: number;
  cost: ItemCostSummary;
  createdAt: string;
}

/** 配件批次（含剩余数量）。 */
export interface AccessoryDto {
  id: string;
  itemId: string;
  name: string;
  unitPriceMinor: number;
  firstUnitExtraMinor: number;
  totalQty: number;
  usedQty: number;
  revertedQty: number;
  remainingQty: number;
  purchasedAt: string;
  /** 关联的购买流水（可选） */
  transactionId: string | null;
  createdAt: string;
}

/** 配件使用审计：正数为消耗、负数为撤销。 */
export interface AccessoryUsageDto {
  id: string;
  accessoryId: string;
  accessoryName: string;
  deltaQty: number;
  usedQtyAfter: number;
  actorUserId: string | null;
  actorName: string | null;
  createdAt: string;
}

/** 成本演进折线的一个点：某日结束时的累计持有成本（分）。 */
export interface CostPointDto {
  date: string;
  holdCostMinor: number;
}

/** 物品详情：成本指标 + 配件批次 + 使用审计 + 成本演进 + 关联流水。 */
export interface ItemDetailDto extends ItemDto {
  accessories: AccessoryDto[];
  usages: AccessoryUsageDto[];
  reverts: InventoryRevertDto[];
  costTimeline: CostPointDto[];
  transactions: TransactionDto[];
}

export interface InventoryRevertDto {
  id: string;
  kind: 'dispose' | 'correction' | 'refund';
  qty: number | null;
  reason: string;
  accessoryId: string | null;
  sourceTransactionId: string | null;
  createdAt: string;
}

/** 物品看板：总投入、在役数量、配件库存价值与成本排行。 */
export interface ItemsOverviewDto {
  /** 全部在册物品的总支付金额之和 */
  payTotalMinor: number;
  /** 当前持有成本之和（物品 + 已用配件） */
  holdCostMinor: number;
  /** 配件库存（未使用）价值之和 */
  remainingStockMinor: number;
  itemCount: number;
  inUseCount: number;
  /** 按日均持有成本倒序的成本排行（前 5 项足够覆盖首页卡片） */
  topCostly: ItemDto[];
}
