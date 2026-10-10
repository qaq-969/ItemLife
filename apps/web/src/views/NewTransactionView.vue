<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { formatMoney, toMinor, toYuan, type ItemDto } from '@itemlife/shared';
import { transactionsApi } from '@/api/ledger';
import { itemsApi } from '@/api/items';
import { ApiError } from '@/api/http';
import AppDateTimePicker from '@/components/AppDateTimePicker.vue';
import AppSelect from '@/components/AppSelect.vue';
import AllocationTreeNode from '@/components/AllocationTreeNode.vue';
import MoneyInput from '@/components/MoneyInput.vue';
import { useLedgerStore } from '@/stores/ledger';
import { useDomainStore } from '@/stores/domain';

type EntryType = 'expense' | 'income' | 'transfer';
type ItemRole = 'body' | 'accessory' | 'fee' | 'link';
interface AllocationRow { key: string; parentKey: string | null; role: ItemRole; itemId: string; name: string; amountYuan: string; qty: string; lifespanDays: string; }

const router = useRouter();
const route = useRoute();
const ledger = useLedgerStore();
const domain = useDomainStore();
const form = reactive({ entry: 'expense' as EntryType, amountYuan: '', accountId: '', toAccountId: '', categoryId: '', occurredAt: nowLocal(), note: '' });
const rows = ref<AllocationRow[]>([]);
const itemOptions = ref<ItemDto[]>([]);
const saving = ref(false);
const errorText = ref<string | null>(null);
const pendingKey = ref<string | null>(null);
const rootMenuOpen = ref(false);
const childMenuParent = ref<string | null>(null);

function nowLocal(): string { const date = new Date(); const pad = (value: number) => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function parseYuan(value: string): number | null { if (!value.trim()) return null; try { return toMinor(value); } catch { return null; } }
/** DTO 临时键上限为 32 字符；预留 item- 前缀后仍保持足够的随机性。 */
function newKey(): string { return crypto.randomUUID().replace(/-/g, '').slice(0, 20); }
function makeRow(parentKey: string | null, role: ItemRole): AllocationRow { return { key: newKey(), parentKey, role, itemId: '', name: '', amountYuan: '', qty: '', lifespanDays: '' }; }

const amountMinor = computed(() => parseYuan(form.amountYuan));
const transactionType = computed(() => form.entry === 'transfer' ? 'transfer_out' as const : form.entry as 'expense' | 'income');
const categories = computed(() => (form.entry === 'income' ? ledger.incomeCategories : ledger.expenseCategories).flatMap((node) => [node, ...node.children.filter((child) => child.archivedAt === null)]));
const accountOptions = computed(() => ledger.accounts.map((account) => ({ value: account.id, label: account.name })));
const categoryOptions = computed(() => [{ value: '', label: '请选择分类' }, ...categories.value.map((category) => ({ value: category.id, label: category.name }))]);
const transferOptions = computed(() => [{ value: '', label: '请选择账户' }, ...accountOptions.value.filter((account) => account.value !== form.accountId)]);
const itemSelectOptions = computed(() => [{ value: '', label: '选择物品' }, ...itemOptions.value.map((item) => ({ value: item.id, label: item.name }))]);
const allocationSum = computed(() => rows.value.reduce((total, row) => total + (row.role === 'link' ? 0 : parseYuan(row.amountYuan) ?? 0), 0));
const remainder = computed(() => Math.max(0, (amountMinor.value ?? 0) - allocationSum.value));
const rootRows = computed(() => rows.value.filter((row) => row.parentKey === null));

function addRootItem(role: 'body' | 'link'): void { rows.value.push(makeRow(null, role)); rootMenuOpen.value = false; }
function toggleChildMenu(parentKey: string): void { childMenuParent.value = childMenuParent.value === parentKey ? null : parentKey; }
function addChild(role: 'accessory' | 'fee'): void { if (childMenuParent.value) rows.value.push(makeRow(childMenuParent.value, role)); childMenuParent.value = null; }
function removeRow(rowKey: string): void { const removed = new Set([rowKey]); for (let changed = true; changed;) { changed = false; rows.value.forEach((row) => { if (row.parentKey && removed.has(row.parentKey) && !removed.has(row.key)) { removed.add(row.key); changed = true; } }); } rows.value = rows.value.filter((row) => !removed.has(row.key)); if (childMenuParent.value && removed.has(childMenuParent.value)) childMenuParent.value = null; }
function rootOf(row: AllocationRow): AllocationRow { let current = row; while (current.parentKey) current = rows.value.find((candidate) => candidate.key === current.parentKey) ?? current; return current; }
function fillRemainder(rowKey: string): void { const index = rows.value.findIndex((row) => row.key === rowKey); if (index < 0) return; const remaining = (amountMinor.value ?? 0) - rows.value.reduce((total, row, current) => total + (current === index || row.role === 'link' ? 0 : parseYuan(row.amountYuan) ?? 0), 0); if (remaining > 0) rows.value[index]!.amountYuan = toYuan(remaining); }
function reset(): void { Object.assign(form, { amountYuan: '', toAccountId: '', categoryId: '', note: '', occurredAt: nowLocal() }); rows.value = []; rootMenuOpen.value = false; childMenuParent.value = null; errorText.value = null; }
function selectEntry(entry: EntryType): void { if (form.entry === entry) return; form.entry = entry; reset(); }

function transactionItems(): Array<Record<string, unknown>> {
  return rows.value.map((row) => {
    const root = row.parentKey ? rootOf(row) : null;
    const itemTarget = row.parentKey ? (root?.role === 'body' ? { itemRef: `item-${root.key}` } : { itemId: root?.itemId }) : (row.role === 'body' ? { newItem: { key: `item-${row.key}`, name: row.name.trim(), ...(row.lifespanDays ? { expectedLifespanDays: Number(row.lifespanDays) } : {}) } } : { itemId: row.itemId });
    return { key: row.key, ...(row.parentKey ? { parentKey: row.parentKey } : {}), ...itemTarget, name: row.name.trim() || undefined, role: row.role, ...(row.role === 'link' ? { amountMinor: 0 } : { amountMinor: parseYuan(row.amountYuan) }), ...(row.role === 'accessory' ? { newAccessory: { name: row.name.trim() || '配件', totalQty: Number(row.qty) } } : {}) };
  });
}

async function submit(): Promise<void> {
  errorText.value = null; const amount = amountMinor.value;
  if (amount === null || amount <= 0) return void (errorText.value = '请填写大于 0 的金额');
  if (!form.accountId) return void (errorText.value = '请选择账户');
  if (form.entry === 'transfer' && (!form.toAccountId || form.toAccountId === form.accountId)) return void (errorText.value = '请选择不同的转入账户');
  if (form.entry !== 'transfer' && !form.categoryId) return void (errorText.value = '请选择分类');
  if (rootRows.value.some((row) => row.role === 'body' && !row.name.trim())) return void (errorText.value = '请填写新建物品名称');
  if (rootRows.value.some((row) => row.role === 'link' && !row.itemId)) return void (errorText.value = '请选择要关联的物品');
  const invalidAccessory = rows.value.find((row) => row.role === 'accessory' && (!row.name.trim() || !Number.isInteger(Number(row.qty)) || Number(row.qty) < 1));
  if (invalidAccessory) return void (errorText.value = '附加物品必须填写名称和正整数数量');
  if (allocationSum.value > amount) return void (errorText.value = '物品与附加费用合计不能超过本笔支出');
  saving.value = true; pendingKey.value ??= crypto.randomUUID();
  try {
    await transactionsApi.create({ type: transactionType.value, amountMinor: amount, accountId: form.accountId, owner: domain.owner, ...(form.entry === 'transfer' ? { toAccountId: form.toAccountId } : { categoryId: form.categoryId }), ...(form.entry === 'expense' && rows.value.length ? { items: transactionItems() as never } : {}), ...(form.occurredAt ? { occurredAt: new Date(form.occurredAt).toISOString() } : {}), ...(form.note.trim() ? { note: form.note.trim() } : {}) }, pendingKey.value);
    await ledger.refresh().catch(() => undefined); await router.push({ name: 'transactions' });
  } catch (error) { errorText.value = error instanceof ApiError ? error.message : '保存失败，请重试'; } finally { saving.value = false; }
}

watch([form, rows], () => { pendingKey.value = null; }, { deep: true });
onMounted(async () => { await ledger.refresh().catch(() => undefined); form.accountId = ledger.accounts[0]?.id ?? ''; itemOptions.value = (await itemsApi.list({ limit: 100, domain: domain.query }).catch(() => ({ items: [] }))).items; if (route.query.addItem === '1') rootMenuOpen.value = true; });
</script>

<template>
  <section class="mx-auto max-w-6xl space-y-4">
    <header class="card p-4">
      <div class="grid grid-cols-3 gap-1 rounded-lg border border-line p-1">
        <button v-for="(label, value) in { expense: '支出', income: '收入', transfer: '转账' }" :key="value" type="button" class="min-h-10 rounded-md text-sm font-semibold transition-colors duration-200" :class="form.entry === value ? 'bg-brand text-white' : 'text-ink-2'" @click="selectEntry(value as EntryType)">{{ label }}</button>
      </div>
      <Transition name="entry" mode="out-in">
        <div :key="form.entry">
          <div class="mt-4"><label class="label">金额（元）</label><MoneyInput v-model="form.amountYuan" input-class="text-xl font-semibold tabular-nums" placeholder="0.00" /></div>
          <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><label class="label">{{ form.entry === 'transfer' ? '转出账户' : '账户' }}</label><AppSelect v-model="form.accountId" :options="accountOptions" /></div>
            <div v-if="form.entry === 'transfer'"><label class="label">转入账户</label><AppSelect v-model="form.toAccountId" :options="transferOptions" /></div>
            <div v-else><label class="label">分类</label><AppSelect v-model="form.categoryId" :options="categoryOptions" /></div>
            <div><label class="label">发生时间</label><AppDateTimePicker v-model="form.occurredAt" mode="datetime" aria-label="发生时间" /></div>
            <div><label class="label">备注</label><input v-model="form.note" class="field" maxlength="200" /></div>
          </div>

          <section v-if="form.entry === 'expense'" class="mt-4 rounded-xl border border-line bg-slate-50/50 p-3">
            <div class="flex items-center justify-between gap-3">
              <div><p class="text-sm font-semibold">物品清单 <span class="font-normal text-ink-3">（可选）</span></p><p class="mt-1 text-xs text-ink-3">不添加物品就是普通记账；需要记物时可添加多个物品及其子项。</p></div>
              <div class="relative shrink-0">
                <button type="button" class="btn btn-ghost min-h-9 px-3 text-xs" @click="rootMenuOpen = !rootMenuOpen">+ 新建项</button>
                <div v-if="rootMenuOpen" class="absolute right-0 z-30 mt-1 w-36 rounded-lg border border-line bg-white p-1 shadow-lg">
                  <button type="button" class="w-full rounded px-3 py-2 text-left text-sm hover:bg-brand-soft" @click="addRootItem('body')">新建物品</button>
                  <button type="button" class="w-full rounded px-3 py-2 text-left text-sm hover:bg-brand-soft" @click="addRootItem('link')">关联物品</button>
                </div>
              </div>
            </div>
            <p class="mt-2 text-xs text-ink-3">子项金额合计 {{ formatMoney(allocationSum) }} · 剩余 {{ formatMoney(remainder) }}</p>
            <div v-if="!rows.length" class="mt-3 rounded-lg border border-dashed border-line bg-white px-3 py-3 text-center text-sm text-ink-3">当前为普通记账；如需记录物品，点击“+ 新建项”。</div>
            <div v-else class="mt-3 space-y-2">
              <AllocationTreeNode v-for="row in rootRows" :key="row.key" :row="row" :all-rows="rows" :item-options="itemSelectOptions" :child-menu-parent="childMenuParent" @fill="fillRemainder" @toggle-child="toggleChildMenu" @add-child="addChild" @remove="removeRow" />
            </div>
          </section>
        </div>
      </Transition>
      <p v-if="errorText" class="form-error mt-3">{{ errorText }}</p>
      <div class="mt-4 flex gap-3"><button type="button" class="btn btn-ghost flex-1" @click="reset">清空</button><button type="button" class="btn btn-primary flex-1" :disabled="saving" @click="submit">{{ saving ? '保存中…' : '保存' }}</button></div>
    </header>
  </section>
</template>
