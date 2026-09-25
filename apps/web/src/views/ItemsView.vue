<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ITEM_STATUSES, formatMoney, type ItemDto, type ItemStatus, type ItemsOverviewDto } from '@itemlife/shared';
import { itemsApi, type ItemQuery } from '@/api/items';
import { ApiError } from '@/api/http';
import AppSelect from '@/components/AppSelect.vue';

const STATUS_LABELS: Record<ItemStatus, string> = {
  in_use: '在役',
  idle: '闲置',
  retired: '退役',
  lost: '遗失',
};

const overview = ref<ItemsOverviewDto | null>(null);
const items = ref<ItemDto[]>([]);
const nextCursor = ref<string | null>(null);
const total = ref(0);
const loading = ref(false);
const loadingMore = ref(false);
const errorText = ref<string | null>(null);
const message = ref<string | null>(null);

const filters = ref<{ status: ItemStatus | ''; keyword: string }>({ status: '', keyword: '' });

/** 筛选变化后重新从第一页拉取（游标分页不适合在客户端过滤）。 */
async function reload(): Promise<void> {
  loading.value = true;
  errorText.value = null;
  try {
    const query: ItemQuery = { limit: 20 };
    if (filters.value.status) query.status = filters.value.status;
    if (filters.value.keyword.trim()) query.keyword = filters.value.keyword.trim();
    const [page, board] = await Promise.all([itemsApi.list(query), itemsApi.overview()]);
    items.value = page.items;
    nextCursor.value = page.nextCursor;
    total.value = page.total ?? page.items.length;
    overview.value = board;
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '物品加载失败，请重试';
  } finally {
    loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  const cursor = nextCursor.value;
  if (!cursor || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const query: ItemQuery = { limit: 20, cursor };
    if (filters.value.status) query.status = filters.value.status;
    if (filters.value.keyword.trim()) query.keyword = filters.value.keyword.trim();
    const page = await itemsApi.list(query);
    items.value = [...items.value, ...page.items];
    nextCursor.value = page.nextCursor;
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '加载更多失败，请重试';
  } finally {
    loadingMore.value = false;
  }
}

function showMessage(text: string): void {
  message.value = text;
  window.setTimeout(() => {
    if (message.value === text) message.value = null;
  }, 3_000);
}

async function remove(item: ItemDto): Promise<void> {
  const reason = window.prompt(`撤销物品「${item.name}」会保留历史流水。请填写原因：`);
  if (!reason?.trim()) return;
  errorText.value = null;
  try {
    await itemsApi.remove(item.id, { reason: reason.trim() });
    showMessage('已生成物品撤销记录');
    await reload();
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '删除失败，请重试';
  }
}

const board = computed(() => overview.value);
const hasFilter = computed(() => Boolean(filters.value.status) || Boolean(filters.value.keyword.trim()));

onMounted(() => {
  void reload();
});
</script>

<template>
  <section class="space-y-4">
    <header class="card p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-xs font-semibold text-ink-3">当前持有成本</p>
          <p class="mt-1 text-2xl font-semibold tabular-nums">
            {{ formatMoney(board?.holdCostMinor ?? 0) }}
          </p>
          <p class="mt-1 text-xs text-ink-3">
            总支付 {{ formatMoney(board?.payTotalMinor ?? 0) }} · 配件库存
            {{ formatMoney(board?.remainingStockMinor ?? 0) }}
          </p>
        </div>
        <RouterLink :to="{ name: 'transaction-new', query: { addItem: '1' } }" class="btn btn-primary">记一笔并录入物品</RouterLink>
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        <span class="rounded-full bg-slate-100 px-3 py-1 text-xs text-ink-2">
          在册 {{ board?.itemCount ?? 0 }} 件
        </span>
        <span class="rounded-full bg-ok-soft px-3 py-1 text-xs text-ok">
          在役 {{ board?.inUseCount ?? 0 }} 件
        </span>
      </div>

      <div v-if="board && board.topCostly.length > 0" class="mt-4 border-t border-line pt-3">
        <p class="text-xs font-semibold text-ink-3">日均持有成本排行</p>
        <ol class="mt-2 space-y-1">
          <li
            v-for="(row, index) in board.topCostly"
            :key="row.id"
            class="flex items-center justify-between gap-3 text-sm"
          >
            <RouterLink :to="{ name: 'item-detail', params: { id: row.id } }" class="min-w-0 truncate">
              <span class="mr-2 text-xs text-ink-3">{{ index + 1 }}.</span>{{ row.name }}
            </RouterLink>
            <span class="shrink-0 tabular-nums text-ink-2">
              {{ formatMoney(row.cost.dailyHoldCostMinor) }}/天
            </span>
          </li>
        </ol>
      </div>
    </header>

    <p v-if="message" class="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{{ message }}</p>
    <p v-if="errorText" class="form-error">{{ errorText }}</p>

    <div class="card flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
      <div class="sm:w-40">
        <label class="label" for="item-status">状态</label>
        <AppSelect v-model="filters.status" :options="[{ value: '', label: '全部' }, ...ITEM_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))]" />
      </div>
      <div class="flex-1">
        <label class="label" for="item-keyword">名称</label>
        <input
          id="item-keyword"
          v-model="filters.keyword"
          class="field"
          maxlength="50"
          placeholder="搜索物品名称"
          @keyup.enter="reload"
        />
      </div>
      <button type="button" class="btn btn-ghost sm:w-24" @click="reload">筛选</button>
    </div>

    <p v-if="loading" class="card p-5 text-sm text-ink-3">正在加载…</p>
    <p v-else-if="items.length === 0" class="card p-5 text-sm text-ink-3">
      {{ hasFilter ? '没有符合条件的物品。' : '还没有物品。录入第一件物品后，就能看到它的日均持有成本了。' }}
    </p>

    <ul v-else class="space-y-2">
      <li v-for="item in items" :key="item.id" class="card p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <RouterLink
                :to="{ name: 'item-detail', params: { id: item.id } }"
                class="truncate font-medium text-brand"
              >
                {{ item.name }}
              </RouterLink>
              <span
                class="shrink-0 rounded px-2 py-0.5 text-xs"
                :class="item.status === 'in_use' ? 'bg-ok-soft text-ok' : 'bg-slate-100 text-ink-3'"
              >
                {{ STATUS_LABELS[item.status] }}
              </span>
              <span v-if="item.category" class="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs text-ink-3">
                {{ item.category.name }}
              </span>
            </div>
            <p class="mt-1 text-xs text-ink-3">
              {{ item.purchaseDate }} 购入 · 本体 {{ formatMoney(item.purchasePriceMinor) }}
              <span v-if="item.accessoryCount > 0">· {{ item.accessoryCount }} 个配件批次</span>
            </p>
          </div>
          <div class="shrink-0 text-right">
            <p class="text-lg font-semibold tabular-nums">{{ formatMoney(item.cost.dailyHoldCostMinor) }}</p>
            <p class="text-xs text-ink-3">日均持有 · {{ item.cost.heldDays }} 天</p>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 px-3 py-2 text-center text-xs">
          <div>
            <p class="text-ink-3">总支付</p>
            <p class="mt-0.5 font-medium tabular-nums">{{ formatMoney(item.cost.payTotalMinor) }}</p>
          </div>
          <div>
            <p class="text-ink-3">当前持有</p>
            <p class="mt-0.5 font-medium tabular-nums">{{ formatMoney(item.cost.holdCostMinor) }}</p>
          </div>
          <div>
            <p class="text-ink-3">配件库存</p>
            <p class="mt-0.5 font-medium tabular-nums">{{ formatMoney(item.cost.remainingStockMinor) }}</p>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-2">
          <RouterLink
            :to="{ name: 'item-detail', params: { id: item.id } }"
            class="btn btn-ghost min-h-9 px-3 text-xs"
          >
            详情与配件
          </RouterLink>
          <RouterLink
            :to="{ name: 'item-edit', params: { id: item.id } }"
            class="btn btn-ghost min-h-9 px-3 text-xs"
          >
            编辑
          </RouterLink>
          <button type="button" class="btn btn-ghost min-h-9 px-3 text-xs text-danger" @click="remove(item)">
            删除
          </button>
        </div>
      </li>
    </ul>

    <div v-if="nextCursor" class="flex justify-center">
      <button type="button" class="btn btn-ghost" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? '加载中…' : `加载更多（共 ${total} 件）` }}
      </button>
    </div>
  </section>
</template>
