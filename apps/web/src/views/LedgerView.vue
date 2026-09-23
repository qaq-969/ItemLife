<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { formatMoney, toMinor, toYuan, type TransactionDto } from '@itemlife/shared';
import { transactionsApi } from '@/api/ledger';
import { ApiError } from '@/api/http';
import { useLedgerStore } from '@/stores/ledger';
import AppModal from '@/components/AppModal.vue';

const TYPE_LABELS: Record<string, string> = { income: '收入', expense: '支出', transfer_in: '转入', transfer_out: '转出' };

const ledger = useLedgerStore();

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
const busy = ref(false);

const categoryOptions = computed(() => {
  const target = editing.value;
  if (!target) return [];
  const kind = target.type === 'income' ? 'income' : 'expense';
  const groups = kind === 'income' ? ledger.incomeCategories : ledger.expenseCategories;
  return groups.flatMap((node) => [node, ...node.children]);
});

function queryParams(): Record<string, string | number> {
  const params: Record<string, string | number> = { limit: 20, from: filters.from, to: filters.to };
  if (filters.type) params.type = filters.type;
  if (filters.accountId) params.accountId = filters.accountId;
  if (filters.categoryId) params.categoryId = filters.categoryId;
  if (filters.keyword.trim()) params.keyword = filters.keyword.trim();
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
  const transferHint = row.transferGroupId ? '这是转账的一条腿，删除会连带删除另一条腿。' : '删除后账户余额会自动回滚。';
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

onMounted(() => {
  void ledger.refresh().catch(() => undefined);
  void load();
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

      <div class="mt-3 grid grid-cols-2 gap-2">
        <input v-model="filters.from" type="date" class="field" aria-label="起始日" />
        <input v-model="filters.to" type="date" class="field" aria-label="结束日" />
        <select v-model="filters.type" class="field" aria-label="类型">
          <option value="">全部类型</option>
          <option value="expense">支出</option>
          <option value="income">收入</option>
        </select>
        <select v-model="filters.accountId" class="field" aria-label="账户">
          <option value="">全部账户</option>
          <option v-for="account in ledger.accounts" :key="account.id" :value="account.id">{{ account.name }}</option>
        </select>
        <select v-model="filters.categoryId" class="field" aria-label="分类">
          <option value="">全部分类</option>
          <option v-for="node in ledger.categories" :key="node.id" :value="node.id">{{ node.name }}</option>
          <option
            v-for="node in ledger.categories.flatMap((item) => item.children)"
            :key="node.id"
            :value="node.id"
          >
            {{ node.name }}
          </option>
        </select>
        <input v-model="filters.keyword" class="field" maxlength="50" placeholder="备注关键词" aria-label="关键词" />
      </div>

      <div class="mt-3 flex gap-2">
        <button type="button" class="btn btn-primary min-h-10 flex-1 text-sm" :disabled="loading" @click="load">
          {{ loading ? '查询中…' : '查询' }}
        </button>
        <button type="button" class="btn btn-ghost min-h-10 text-sm" @click="resetFilters">重置</button>
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
              关联物品 {{ row.items.length }} 个
              <span v-for="link in row.items" :key="link.itemId">
                · 分摊 {{ formatMoney(link.amountMinor ?? row.amountMinor) }}
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

    <AppModal :open="editing !== null" title="编辑流水" @close="editing = null">
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
          <select id="edit-category" v-model="editForm.categoryId" class="field">
            <option value="">（无分类）</option>
            <option v-for="node in categoryOptions" :key="node.id" :value="node.id">{{ node.name }}</option>
          </select>
        </div>

        <div>
          <label class="label" for="edit-time">发生时间</label>
          <input id="edit-time" v-model="editForm.occurredAt" type="datetime-local" class="field" />
        </div>

        <div>
          <label class="label" for="edit-note">备注</label>
          <input id="edit-note" v-model="editForm.note" class="field" maxlength="200" />
        </div>

        <p v-if="errorText" class="form-error">{{ errorText }}</p>

        <div class="flex gap-3">
          <button type="button" class="btn btn-ghost flex-1" @click="editing = null">取消</button>
          <button type="submit" class="btn btn-primary flex-1" :disabled="busy">{{ busy ? '保存中…' : '保存' }}</button>
        </div>
      </form>
    </AppModal>
  </section>
</template>
