<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { formatMoney, toMinor, toYuan, type AllocationRole, type TransactionDto } from '@itemlife/shared';
import { transactionsApi } from '@/api/ledger';
import { ApiError } from '@/api/http';
import { useLedgerStore } from '@/stores/ledger';
import { useDomainStore } from '@/stores/domain';
import AppModal from '@/components/AppModal.vue';
import AppSelect from '@/components/AppSelect.vue';

const TYPE_LABELS: Record<string, string> = { income: '收入', expense: '支出', transfer_in: '转入', transfer_out: '转出' };

const ledger = useLedgerStore();
const domain = useDomainStore();
const route = useRoute();

const items = ref<TransactionDto[]>([]);
const nextCursor = ref<string | null>(null);
const total = ref(0);
const summary = ref<{ incomeMinor: number; expenseMinor: number; netMinor: number } | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const errorText = ref<string | null>(null);
const message = ref<string | null>(null);

function dateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const monthStart = new Date();
monthStart.setDate(1);

const filters = reactive({
  type: '' as '' | 'income' | 'expense',
  accountId: '',
  categoryId: '',
  from: dateOnly(monthStart),
  to: dateOnly(new Date()),
  keyword: '',
});

const editing = ref<TransactionDto | null>(null);
const editForm = reactive({ amountYuan: '', note: '', occurredAt: '', categoryId: '' });
interface EditAllocation {
  id: string;
  parentId: string | null;
  itemId: string;
  accessoryId: string | null;
  role: AllocationRole;
  name: string;
  amountYuan: string;
  quantity: number | null;
  unitPriceMinor: number | null;
  firstUnitExtraMinor: number;
  usedQty: number | null;
  revertedQty: number | null;
  itemDeletedAt: string | null;
}
const editItems = ref<EditAllocation[]>([]);
const busy = ref(false);
const ROLE_LABELS: Record<AllocationRole, string> = { body: '物品', link: '关联物品', accessory: '配件', fee: '附加费用' };

const categoryOptions = computed(() => {
  const target = editing.value;
  if (!target) return [];
  const kind = target.type === 'income' ? 'income' : 'expense';
  const groups = kind === 'income' ? ledger.incomeCategories : ledger.expenseCategories;
  return groups.flatMap((node) => [node, ...node.children]);
});
const filterTypeOptions = [
  { value: '', label: '全部类型' },
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
];
const filterAccountOptions = computed(() => [{ value: '', label: '全部账户' }, ...ledger.accounts.map((account) => ({ value: account.id, label: account.name }))]);
const filterCategoryOptions = computed(() => [{ value: '', label: '全部分类' }, ...ledger.categories.flatMap((node) => [node, ...node.children]).map((category) => ({ value: category.id, label: category.name }))]);
const editCategoryOptions = computed(() => [{ value: '', label: '（无分类）' }, ...categoryOptions.value.map((category) => ({ value: category.id, label: category.name }))]);

function queryParams(): Record<string, string | number> {
  const params: Record<string, string | number> = { limit: 20, from: filters.from, to: filters.to };
  if (domain.query) params.domain = domain.query;
  if (filters.type) params.type = filters.type;
  if (filters.accountId) params.accountId = filters.accountId;
  if (filters.categoryId) params.categoryId = filters.categoryId;
  if (filters.keyword.trim()) params.keyword = filters.keyword.trim();
  if (typeof route.query.itemId === 'string') params.itemId = route.query.itemId;
  return params;
}

function showMessage(text: string): void {
  message.value = text;
  window.setTimeout(() => {
    if (message.value === text) message.value = null;
  }, 3_000);
}

async function load(): Promise<void> {
  loading.value = true;
  errorText.value = null;
  try {
    const page = await transactionsApi.list(queryParams());
    items.value = page.items;
    nextCursor.value = page.nextCursor;
    total.value = page.total ?? page.items.length;

    const range = await transactionsApi.summary({
      from: filters.from,
      to: filters.to,
      ...(domain.query ? { domain: domain.query } : {}),
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
    });
    summary.value = range;
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '流水加载失败';
  } finally {
    loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  if (!nextCursor.value) return;
  loadingMore.value = true;
  try {
    const page = await transactionsApi.list({ ...queryParams(), cursor: nextCursor.value });
    items.value = [...items.value, ...page.items];
    nextCursor.value = page.nextCursor;
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '加载更多失败';
  } finally {
    loadingMore.value = false;
  }
}

function resetFilters(): void {
  Object.assign(filters, {
    type: '',
    accountId: '',
    categoryId: '',
    from: dateOnly(monthStart),
    to: dateOnly(new Date()),
    keyword: '',
  });
  void load();
}

function signedAmount(row: TransactionDto): string {
  const text = formatMoney(row.amountMinor);
  if (row.type === 'income' || row.type === 'transfer_in') return `+${text}`;
  if (row.type === 'expense' || row.type === 'transfer_out') return `-${text}`;
  return text;
}

function amountClass(row: TransactionDto): string {
  if (row.type === 'income') return 'text-ok';
  if (row.type === 'expense') return 'text-ink';
  return 'text-ink-3';
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function openEdit(row: TransactionDto): void {
  editing.value = row;
  const date = new Date(row.occurredAt);
  const pad = (value: number): string => String(value).padStart(2, '0');
  Object.assign(editForm, {
    amountYuan: toYuan(row.amountMinor),
    note: row.note ?? '',
    occurredAt: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`,
    categoryId: row.categoryId ?? '',
  });
  editItems.value = row.items.map((link) => ({
    id: link.id,
    parentId: link.parentId,
    itemId: link.itemId,
    accessoryId: link.accessoryId,
    role: link.role,
    name: link.name,
    amountYuan: link.role === 'link' ? '' : toYuan(link.amountMinor ?? row.amountMinor),
    quantity: link.quantity,
    unitPriceMinor: link.unitPriceMinor,
    firstUnitExtraMinor: link.firstUnitExtraMinor,
    usedQty: link.usedQty,
    revertedQty: link.revertedQty,
    itemDeletedAt: link.itemDeletedAt,
  }));
}

function editDepth(row: EditAllocation): number {
  const parents = new Map(editItems.value.map((item) => [item.id, item.parentId]));
  let depth = 0;
  let cursor = row.parentId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    depth += 1;
    cursor = parents.get(cursor) ?? null;
  }
  return depth;
}

function accessoryHint(row: EditAllocation): string {
  if (row.role !== 'accessory' || row.quantity === null || row.unitPriceMinor === null) return '';
  const extra = row.firstUnitExtraMinor > 0 ? `，首件补余 ${formatMoney(row.firstUnitExtraMinor)}` : '';
  return `${row.quantity} 件 × ${formatMoney(row.unitPriceMinor)}${extra}；已用 ${row.usedQty ?? 0}`;
}

async function submitEdit(): Promise<void> {
  const target = editing.value;
  if (!target) return;

  let amountMinor: number;
  try {
    amountMinor = toMinor(editForm.amountYuan);
  } catch {
    errorText.value = '金额格式不正确（最多两位小数）';
    return;
  }
  if (amountMinor <= 0) {
    errorText.value = '金额需大于 0';
    return;
  }

  const allocations: Array<Record<string, unknown>> = [];
  let allocatedMinor = 0;
  for (const row of editItems.value) {
    const name = row.name.trim();
    if (!name) {
      errorText.value = `${ROLE_LABELS[row.role]}名称不能为空`;
      return;
    }
    let lineAmount = 0;
    if (row.role !== 'link') {
      try {
        lineAmount = toMinor(row.amountYuan);
      } catch {
        errorText.value = `${name}的金额格式不正确`;
        return;
      }
      if (lineAmount < 0) {
        errorText.value = `${name}的金额不能为负`;
        return;
      }
      allocatedMinor += lineAmount;
    }
    allocations.push({
      key: row.id.replace(/-/g, ''),
      ...(row.parentId ? { parentKey: row.parentId.replace(/-/g, '') } : {}),
      itemId: row.itemId,
      name,
      role: row.role,
      amountMinor: lineAmount,
      ...(row.accessoryId ? { accessoryId: row.accessoryId } : {}),
    });
  }
  if (allocatedMinor > amountMinor) {
    errorText.value = '物品与配件明细合计不能超过流水金额';
    return;
  }

  busy.value = true;
  errorText.value = null;
  try {
    await transactionsApi.update(target.id, {
      amountMinor,
      note: editForm.note.trim() || null,
      occurredAt: new Date(editForm.occurredAt).toISOString(),
      // 转账不能挂分类，服务端会拒绝
      ...(target.type === 'transfer_in' || target.type === 'transfer_out'
        ? {}
        : { categoryId: editForm.categoryId || null }),
      ...(!target.transferGroupId && editItems.value.length > 0 ? { items: allocations } : {}),
    });
    editing.value = null;
    showMessage('流水已更新');
    await Promise.all([load(), ledger.refresh()]);
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '保存失败，请重试';
  } finally {
    busy.value = false;
  }
}

async function remove(row: TransactionDto): Promise<void> {
  const transferHint = row.transferGroupId
    ? '这是转账的一条腿，删除会连带删除另一条腿。'
    : row.items.length > 0
      ? '本流水新建的物品会同步删除；给已有物品追加的配件也会撤销。若这些物品还出现在其他共享流水中，对应明细会移除且金额实时扣减。'
      : '删除后账户余额会自动回滚。';
  if (!window.confirm(`删除这笔${TYPE_LABELS[row.type] ?? ''}流水？${transferHint}`)) return;
  busy.value = true;
  try {
    await transactionsApi.remove(row.id);
    showMessage('流水已删除');
    await Promise.all([load(), ledger.refresh()]);
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '删除失败，请重试';
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  if (typeof route.query.from === 'string') filters.from = route.query.from;
  if (typeof route.query.to === 'string') filters.to = route.query.to;
  await Promise.all([ledger.refresh().catch(() => undefined), load()]);
  if (typeof route.query.edit === 'string') {
    const target = items.value.find((row) => row.id === route.query.edit);
    if (target) openEdit(target);
  }
});
</script>

<template>
  <section class="space-y-4">
    <header class="card p-4">
      <div class="grid grid-cols-3 gap-2 text-center">
        <div>
          <p class="text-xs text-ink-3">收入</p>
          <p class="mt-1 text-sm font-semibold tabular-nums text-ok">
            {{ formatMoney(summary?.incomeMinor ?? 0) }}
          </p>
        </div>
        <div>
          <p class="text-xs text-ink-3">支出</p>
          <p class="mt-1 text-sm font-semibold tabular-nums">{{ formatMoney(summary?.expenseMinor ?? 0) }}</p>
        </div>
        <div>
          <p class="text-xs text-ink-3">结余</p>
          <p class="mt-1 text-sm font-semibold tabular-nums">{{ formatMoney(summary?.netMinor ?? 0) }}</p>
        </div>
      </div>
      <p class="mt-3 border-t border-line pt-3 text-xs text-ink-3">
        {{ filters.from }} ~ {{ filters.to }} 共 {{ total }} 笔（转账不计入收支小计）
      </p>

      <div class="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <input v-model="filters.from" type="date" class="field sm:w-36" aria-label="起始日" />
        <input v-model="filters.to" type="date" class="field sm:w-36" aria-label="结束日" />
        <AppSelect v-model="filters.type" class="sm:w-28" :options="filterTypeOptions" aria-label="类型" />
        <AppSelect v-model="filters.accountId" class="sm:w-32" :options="filterAccountOptions" aria-label="账户" />
        <AppSelect v-model="filters.categoryId" class="sm:w-32" :options="filterCategoryOptions" aria-label="分类" />
        <input v-model="filters.keyword" class="field sm:w-40" maxlength="50" placeholder="备注关键词" aria-label="关键词" />
      </div>

      <div class="mt-3 flex gap-2">
        <button type="button" class="btn btn-primary min-h-10 flex-1 px-5 text-sm sm:flex-none" :disabled="loading" @click="load">
          {{ loading ? '查询中…' : '查询' }}
        </button>
        <button type="button" class="btn btn-ghost min-h-10 flex-1 px-5 text-sm sm:flex-none" @click="resetFilters">重置</button>
      </div>
    </header>

    <p v-if="message" class="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{{ message }}</p>
    <p v-if="errorText" class="form-error">{{ errorText }}</p>

    <div v-if="items.length === 0 && !loading" class="card p-5 text-sm text-ink-3">
      该区间没有流水。去「记一笔」记录第一笔支出或收入吧。
    </div>

    <ul v-else class="space-y-2">
      <li v-for="row in items" :key="row.id" class="card">
        <button type="button" class="flex w-full items-center gap-3 p-3 text-left" @click="openEdit(row)">
          <span class="size-2.5 shrink-0 rounded-full" :style="{ background: row.category?.color ?? '#cbd5e1' }"></span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">
              {{ row.category?.name ?? TYPE_LABELS[row.type] }}
              <span v-if="row.systemTag" class="ml-1 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] text-brand">系统</span>
            </p>
            <p class="truncate text-xs text-ink-3">
              {{ timeLabel(row.occurredAt) }} · {{ row.account.name }}
              <span v-if="row.note"> · {{ row.note }}</span>
            </p>
            <p v-if="row.items.length > 0" class="mt-0.5 truncate text-xs text-brand">
              明细 {{ row.items.length }} 项
              <span v-for="link in row.items" :key="link.id">
                · {{ link.name }}<template v-if="link.role !== 'link'"> {{ formatMoney(link.amountMinor ?? row.amountMinor) }}</template>
              </span>
            </p>
          </div>
          <div class="shrink-0 text-right">
            <p class="text-sm font-semibold tabular-nums" :class="amountClass(row)">{{ signedAmount(row) }}</p>
            <p class="text-[11px] text-ink-3">{{ TYPE_LABELS[row.type] }}</p>
          </div>
        </button>
        <div class="flex justify-end gap-2 border-t border-line px-3 py-2">
          <button type="button" class="btn btn-ghost min-h-9 px-3 text-xs" @click="openEdit(row)">编辑</button>
          <button type="button" class="btn btn-ghost min-h-9 px-3 text-xs text-danger" :disabled="busy" @click="remove(row)">
            删除
          </button>
        </div>
      </li>
    </ul>

    <button
      v-if="nextCursor"
      type="button"
      class="btn btn-ghost w-full"
      :disabled="loadingMore"
      @click="loadMore"
    >
      {{ loadingMore ? '加载中…' : '加载更多' }}
    </button>

    <AppModal :open="editing !== null" title="查看与编辑流水" wide @close="editing = null">
      <form class="space-y-4" @submit.prevent="submitEdit">
        <p class="rounded-lg bg-slate-100 px-3 py-2 text-xs text-ink-2">
          {{ TYPE_LABELS[editing?.type ?? 'expense'] }} · {{ editing?.account.name }}
          <span v-if="editing?.transferGroupId">（转账改动会同步另一条腿）</span>
        </p>

        <div>
          <label class="label" for="edit-amount">金额（元）</label>
          <input id="edit-amount" v-model="editForm.amountYuan" class="field" inputmode="decimal" />
        </div>

        <div v-if="!editing?.transferGroupId">
          <label class="label" for="edit-category">分类</label>
          <AppSelect id="edit-category" v-model="editForm.categoryId" :options="editCategoryOptions" />
        </div>

        <div>
          <label class="label" for="edit-time">发生时间</label>
          <input id="edit-time" v-model="editForm.occurredAt" type="datetime-local" class="field" />
        </div>

        <div>
          <label class="label" for="edit-note">备注</label>
          <input id="edit-note" v-model="editForm.note" class="field" maxlength="200" />
        </div>

        <section v-if="editItems.length" class="rounded-xl border border-line p-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="text-sm font-semibold">物品、配件与费用明细</h3>
              <p class="mt-0.5 text-xs text-ink-3">名称和价格保存后会同步到物品页；已使用的配件价格会锁定。</p>
            </div>
            <span class="shrink-0 text-xs text-ink-3">{{ editItems.length }} 项</span>
          </div>
          <div class="mt-3 space-y-2">
            <div
              v-for="row in editItems"
              :key="row.id"
              class="rounded-lg border border-line bg-white p-2"
              :style="{ marginLeft: `${Math.min(editDepth(row), 5) * 12}px` }"
            >
              <div class="grid grid-cols-[auto_minmax(0,1fr)_7rem] items-center gap-2">
                <span class="rounded bg-brand-soft px-2 py-1 text-xs font-medium text-brand">{{ ROLE_LABELS[row.role] }}</span>
                <input v-model="row.name" class="field min-w-0" maxlength="100" :disabled="Boolean(row.itemDeletedAt)" aria-label="明细名称" />
                <input
                  v-model="row.amountYuan"
                  class="field text-right tabular-nums"
                  inputmode="decimal"
                  :disabled="row.role === 'link' || (row.role === 'accessory' && ((row.usedQty ?? 0) > 0 || (row.revertedQty ?? 0) > 0))"
                  :placeholder="row.role === 'link' ? '仅关联' : '金额'"
                  aria-label="明细金额"
                />
              </div>
              <p v-if="accessoryHint(row)" class="mt-1 text-xs text-ink-3">{{ accessoryHint(row) }}</p>
              <p v-if="row.itemDeletedAt" class="mt-1 text-xs text-danger">该物品已撤销，仅保留历史明细。</p>
            </div>
          </div>
        </section>

        <p v-if="errorText" class="form-error">{{ errorText }}</p>

        <div class="flex gap-3">
          <button type="button" class="btn btn-ghost flex-1" @click="editing = null">取消</button>
          <button type="submit" class="btn btn-primary flex-1" :disabled="busy">{{ busy ? '保存中…' : '保存' }}</button>
        </div>
      </form>
    </AppModal>
  </section>
</template>
