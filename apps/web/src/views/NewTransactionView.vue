<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { formatMoney, toMinor } from '@itemlife/shared';
import { transactionsApi } from '@/api/ledger';
import { ApiError } from '@/api/http';
import { useLedgerStore } from '@/stores/ledger';

type EntryType = 'expense' | 'income' | 'transfer';

const ENTRY_LABELS: Record<EntryType, string> = { expense: '支出', income: '收入', transfer: '转账' };

const router = useRouter();
const ledger = useLedgerStore();

function nowLocal(): string {
  const date = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const form = reactive({
  entry: 'expense' as EntryType,
  amountYuan: '',
  accountId: '',
  toAccountId: '',
  categoryId: '',
  occurredAt: nowLocal(),
  note: '',
});

const saving = ref(false);
const errorText = ref<string | null>(null);
/** 幂等键：同一次提交重试复用；表单被改动后重新生成，避免用旧键拿回上一笔 */
const pendingKey = ref<string | null>(null);

watch(
  () => ({ ...form }),
  () => {
    pendingKey.value = null;
  },
);

const transactionType = computed(() =>
  form.entry === 'transfer' ? ('transfer_out' as const) : (form.entry as 'expense' | 'income'),
);

const categoryOptions = computed(() => {
  const groups = form.entry === 'income' ? ledger.incomeCategories : ledger.expenseCategories;
  return groups.flatMap((node) => [node, ...node.children.filter((child) => child.archivedAt === null)]);
});

const selectedAccount = computed(() => ledger.accounts.find((item) => item.id === form.accountId) ?? null);

const amountMinor = computed(() => {
  try {
    return toMinor(form.amountYuan || '0');
  } catch {
    return null;
  }
});

async function submit(): Promise<void> {
  errorText.value = null;

  const amount = amountMinor.value;
  if (amount === null || amount <= 0) {
    errorText.value = '请填写大于 0 的金额（最多两位小数）';
    return;
  }
  if (!form.accountId) {
    errorText.value = form.entry === 'transfer' ? '请选择转出账户' : '请选择账户';
    return;
  }
  if (form.entry === 'transfer' && !form.toAccountId) {
    errorText.value = '请选择转入账户';
    return;
  }
  if (form.entry === 'transfer' && form.accountId === form.toAccountId) {
    errorText.value = '转出与转入账户不能相同';
    return;
  }
  if (form.entry !== 'transfer' && !form.categoryId) {
    errorText.value = '请选择分类';
    return;
  }

  const occurredAt = form.occurredAt ? new Date(form.occurredAt).toISOString() : undefined;
  pendingKey.value ??= crypto.randomUUID();

  saving.value = true;
  try {
    await transactionsApi.create(
      {
        type: transactionType.value,
        amountMinor: amount,
        accountId: form.accountId,
        ...(form.entry === 'transfer' ? { toAccountId: form.toAccountId } : { categoryId: form.categoryId }),
        ...(occurredAt ? { occurredAt } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      },
      pendingKey.value,
    );

    pendingKey.value = null;
    await ledger.refresh().catch(() => undefined);
    await router.push({ name: 'transactions' });
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '保存失败，请重试';
  } finally {
    saving.value = false;
  }
}

function resetForm(): void {
  Object.assign(form, {
    amountYuan: '',
    categoryId: '',
    note: '',
    occurredAt: nowLocal(),
  });
}

onMounted(async () => {
  await ledger.refresh().catch(() => undefined);
  form.accountId = ledger.accounts[0]?.id ?? '';
  if (ledger.accounts.length === 0) {
    errorText.value = '还没有账户，请先到「账户」页新建一个。';
  }
});
</script>

<template>
  <section class="space-y-4">
    <header class="card p-4">
      <div class="grid grid-cols-3 gap-1 rounded-lg border border-line p-1">
        <button
          v-for="(label, value) in ENTRY_LABELS"
          :key="value"
          type="button"
          class="min-h-10 rounded-md text-sm font-semibold"
          :class="form.entry === value ? 'bg-brand text-white' : 'text-ink-2'"
          @click="form.entry = value; resetForm()"
        >
          {{ label }}
        </button>
      </div>

      <div class="mt-4">
        <label class="label" for="amount">金额（元）</label>
        <input
          id="amount"
          v-model="form.amountYuan"
          class="field text-xl font-semibold tabular-nums"
          inputmode="decimal"
          placeholder="0.00"
          autocomplete="off"
        />
      </div>

      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label class="label" for="account">{{ form.entry === 'transfer' ? '转出账户' : '账户' }}</label>
          <select id="account" v-model="form.accountId" class="field">
            <option v-for="account in ledger.accounts" :key="account.id" :value="account.id">
              {{ account.name }}
            </option>
          </select>
          <p v-if="selectedAccount" class="mt-1 text-xs text-ink-3">
            当前余额 {{ formatMoney(selectedAccount.balanceMinor) }}
          </p>
        </div>

        <div v-if="form.entry === 'transfer'">
          <label class="label" for="to-account">转入账户</label>
          <select id="to-account" v-model="form.toAccountId" class="field">
            <option value="">请选择</option>
            <option v-for="account in ledger.accounts" :key="account.id" :value="account.id">
              {{ account.name }}
            </option>
          </select>
        </div>

        <div v-else>
          <label class="label" for="category">分类</label>
          <select id="category" v-model="form.categoryId" class="field">
            <option value="">请选择</option>
            <option v-for="node in categoryOptions" :key="node.id" :value="node.id">{{ node.name }}</option>
          </select>
        </div>

        <div>
          <label class="label" for="occurred-at">发生时间</label>
          <input id="occurred-at" v-model="form.occurredAt" type="datetime-local" class="field" />
        </div>

        <div>
          <label class="label" for="note">备注</label>
          <input id="note" v-model="form.note" class="field" maxlength="200" placeholder="午饭 + 咖啡" />
        </div>
      </div>

      <p v-if="form.entry === 'transfer'" class="mt-3 rounded-lg bg-brand-soft px-3 py-2 text-xs text-ink-2">
        转账会成对写入「转出 + 转入」两条腿，两个账户余额同时变化；因此不能挂分类。
      </p>

      <p v-else class="mt-3 text-xs text-ink-3">
        关联物品分摊（一笔流水分摊到多个物品）将在物品模块（M3）上线后可在此选择，服务端校验已就绪。
      </p>

      <p v-if="errorText" class="form-error mt-3">{{ errorText }}</p>

      <div class="mt-4 flex gap-3">
        <button type="button" class="btn btn-ghost flex-1" @click="resetForm">清空</button>
        <button type="button" class="btn btn-primary flex-1" :disabled="saving" @click="submit">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </header>
  </section>
</template>
