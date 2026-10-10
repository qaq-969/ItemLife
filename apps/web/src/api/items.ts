import type {
  AccessoryUsageDto,
  ItemDetailDto,
  ItemDto,
  ItemsOverviewDto,
  ItemStatus,
  Paginated,
} from '@itemlife/shared';
import { http, unwrap } from './http';
import type { OwnerBody } from './ledger';

export interface AccessoryPayload {
  name: string;
  unitPriceMinor: number;
  totalQty: number;
  /** YYYY-MM-DD；省略取物品购买日（追加批次时取今天） */
  purchasedAt?: string;
  /** 初始已用数量，会同步写一条使用审计 */
  usedQty?: number;
  transactionId?: string;
}

export interface ItemPayload {
  name: string;
  purchaseDate: string;
  purchasePriceMinor: number;
  categoryId?: string;
  expectedLifespanDays?: number;
  status?: ItemStatus;
  note?: string;
  accessories?: AccessoryPayload[];
  owner?: OwnerBody;
}

export interface ItemPatch {
  name?: string;
  categoryId?: string | null;
  purchaseDate?: string;
  purchasePriceMinor?: number;
  /** null = 清空预期寿命（预计日均成本随之消失） */
  expectedLifespanDays?: number | null;
  status?: ItemStatus;
  note?: string | null;
}

export interface InventoryRevertPayload {
  kind?: 'dispose' | 'correction';
  reason: string;
  qty?: number;
}

export interface ItemQuery {
  domain?: string;
  status?: ItemStatus;
  categoryId?: string;
  keyword?: string;
  cursor?: string;
  limit?: number;
}

export const itemsApi = {
  list: (params: ItemQuery = {}) => unwrap<Paginated<ItemDto>>(http.get('/items', { params })),
  overview: (params: { domain?: string } = {}) =>
    unwrap<ItemsOverviewDto>(http.get('/items/overview', { params })),
  detail: (id: string) => unwrap<ItemDetailDto>(http.get(`/items/${id}`)),
  create: (payload: ItemPayload) => unwrap<ItemDto>(http.post('/items', payload)),
  update: (id: string, payload: ItemPatch) => unwrap<ItemDto>(http.patch(`/items/${id}`, payload)),
  remove: (id: string, payload: InventoryRevertPayload) => unwrap<null>(http.delete(`/items/${id}`, { data: payload })),

  removeAccessory: (id: string, payload: InventoryRevertPayload) => unwrap<null>(http.delete(`/accessories/${id}`, { data: payload })),
  /** 使用 n 个配件（默认 1）：不可超过剩余 */
  consume: (id: string, qty = 1) => unwrap<AccessoryUsageDto>(http.post(`/accessories/${id}/consume`, { qty })),
  /** 撤销 n 个（默认 1）：不可小于 0 */
  restore: (id: string, qty = 1) => unwrap<AccessoryUsageDto>(http.post(`/accessories/${id}/restore`, { qty })),
};
