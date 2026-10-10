<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  ACCOUNT_TYPES,
  INTEREST_FREQS,
  formatMoney,
  toMinor,
  toYuan,
  type AccountDto,
  type AccountType,
  type InterestFreq,
  type InterestRunResult,
} from '@itemlife/shared';
import { accountsApi, interestApi } from '@/api/ledger';
import { ApiError } from '@/api/http';
import { useLedgerStore } from '@/stores/ledger';
import { useDomainStore } from '@/stores/domain';
import AppModal from '@/components/AppModal.vue';
import AppSelect from '@/components/AppSelect.vue';
import MoneyInput from '@/components/MoneyInput.vue';

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: '现金',
  bank: '银行卡',
  payment: '支付账户',
  investment: '投资理财',
  receivable: '应收款',
  payable: '应付款',
};

const FREQ_LABELS: Record<InterestFreq, string> = {
  monthly: '每月',
  quarterly: '每季度',
  yearly: '每年',
};

const ledger = useLedgerStore();
const domain = useDomainStore();

const message = ref<string | null>(null);
const errorText = ref<string | null>(null);
const saving = ref(false);

const formOpen = ref(false);
const editingId = ref<string | null>(null);
const form = reactive({
  name: '',
  type: 'bank' as AccountType,
  initialYuan: '0.00',
  interestEnabled: false,
  ratePercent: '',
  freq: 'monthly' as InterestFreq,
});

const settleTarget = ref<AccountDto | null>(null);
const settlePreview = ref<InterestRunResult | null>(null);
const settleError = ref<string | null>(null);

const totalText = computed(() => formatMoney(ledger.summary?.totalMinor ?? 0));
const interestAccounts = computed(() => ledger.accounts.filter((item) => item.interestRateBp !== null));

function showMessage(text: string): void {
  message.value = text;
  window.setTimeout(() => {
    if (message.value === text) message.value = null;
  }, 3_000);
}

function openCreate(): void {
  editingId.value = null;
  Object.assign(form, {
    name: '',
    type: 'bank',
    initialYuan: '0.00',
    interestEnabled: false,
    ratePercent: '',
    freq: 'monthly' as InterestFreq,
  });
  errorText.value = null;
  formOpen.value = true;
}

function openEdit(account: AccountDto): void {
  editingId.value = account.id;
  Object.assign(form, {
    name: account.name,
    type: account.type,
    initialYuan: toYuan(account.initialBalanceMinor),
    interestEnabled: account.interestRateBp !== null,
    ratePercent: account.interestRateBp === null ? '' : (account.interestRateBp / 100).toString(),
    freq: account.interestFreq ?? 'monthly',
  });
  errorText.value = null;
  formOpen.value = true;
}

async function submit(): Promise<void> {
  errorText.value = null;
  const name = form.name.trim();
  if (!name) {
    errorText.value = '请填写账户名称';
    return;
  }

  let initialBalanceMinor = 0;
  if (!editingId.value) {
    try {
      initialBalanceMinor = toMinor(form.initialYuan || '0');
    } catch {
      errorText.value = '初始余额格式不正确（最多两位小数）';
      return;
    }
  }

  let rateBp: number | null = null;
  if (form.interestEnabled) {
    const percent = Number(form.ratePercent);
    if (!Number.isFinite(percent) || percent <= 0) {
      errorText.value = '请填写年化利率（如 1.75 表示 1.75%）';
      return;
    }
    rateBp = Math.round(percent * 100);
    if (rateBp < 1 || rateBp > 10_000) {
      errorText.value = '年化利率需在 0.01% ~ 100% 之间';
      return;
    }
  }

  saving.value = true;
  try {
    if (editingId.value) {
      await accountsApi.update(editingId.value, {
        name,
        type: form.type,
        interestRateBp: rateBp,
        interestFreq: rateBp === null ? null : form.freq,
      });
      showMessage('账户已更新');
    } else {
      await accountsApi.create({
        name,
        type: form.type,
        initialBalanceMinor,
        ...(rateBp === null ? {} : { interestRateBp: rateBp, interestFreq: form.freq }),
        owner: domain.owner,
      });
      showMessage('账户已创建');
    }
    formOpen.value = false;
    await ledger.refresh();
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '保存失败，请重试';
  } finally {
    saving.value = false;
  }
}

async function remove(account: AccountDto): Promise<void> {
  if (!window.confirm(`删除账户「${account.name}」？已有流水的账户不可删除。`)) return;
  try {
    await accountsApi.remove(account.id);
    showMessage('账户已删除');
    await ledger.refresh();
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '删除失败，请重试';
  }
}

async function openSettle(account: AccountDto): Promise<void> {
  settleTarget.value = account;
  settlePreview.value = null;
  settleError.value = null;
  try {
    const rows = await interestApi.preview({ accountId: account.id, domain: domain.query });
    settlePreview.value = rows[0] ?? null;
    if (!settlePreview.value) settleError.value = '今天尚未产生新的计息天数';
  } catch (error) {
    settleError.value = error instanceof ApiError ? error.message : '预估失败，请重试';
  }
}

async function confirmSettle(): Promise<void> {
  const target = settleTarget.value;
  if (!target) return;
  saving.value = true;
  settleError.value = null;
  try {
    const result = await interestApi.post(target.id);
    settleTarget.value = null;
    showMessage(`已结息 ${formatMoney(result.interestMinor)}（${result.from} ~ ${result.to}）`);
    await ledger.refresh();
  } catch (error) {
    settleError.value = error instanceof ApiError ? error.message : '结息失败，请重试';
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void ledger.ensureLoaded().catch(() => undefined);
});
</script>

<template>
  <section class="space-y-4">
    <header class="card p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-xs font-semibold text-ink-3">账户总余额</p>
          <p class="mt-1 text-2xl font-semibold tabular-nums">{{ totalText }}</p>
        </div>
        <button type="button" class="btn btn-primary" @click="openCreate">新建账户</button>
      </div>

      <div v-if="ledger.summary && ledger.summary.byType.length > 0" class="mt-4 flex flex-wrap gap-2">
        <span
          v-for="row in ledger.summary.byType"
          :key="row.type"
          class="rounded-full bg-slate-100 px-3 py-1 text-xs text-ink-2"
        >
          {{ ACCOUNT_TYPE_LABELS[row.type] }} {{ formatMoney(row.totalMinor) }} · {{ row.count }} 个
        </span>
      </div>
      <p class="mt-3 text-xs text-ink-3">余额由流水实时派生：初始余额 + 收入 − 支出 + 转入 − 转出。</p>
    </header>

    <p v-if="message" class="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{{ message }}</p>
    <p v-if="errorText" class="form-error">{{ errorText }}</p>

    <div v-if="ledger.accounts.length === 0" class="card p-5 text-sm text-ink-3">
      还没有账户。先创建一个（如「现金」「招商银行储蓄卡」），记一笔时就能选它了。
    </div>

    <ul v-else class="space-y-2">
      <li v-for="account in ledger.accounts" :key="account.id" class="card p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="truncate font-medium">{{ account.name }}</span>
              <span class="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs text-ink-3">
                {{ ACCOUNT_TYPE_LABELS[account.type] }}
              </span>
            </div>
            <p v-if="account.interestRateBp !== null" class="mt-1 text-xs text-ok">
              年化 {{ (account.interestRateBp / 100).toFixed(2) }}% ·
              {{ FREQ_LABELS[account.interestFreq ?? 'monthly'] }}结息
              <span v-if="account.interestPostedAt">· 上次 {{ account.interestPostedAt }}</span>
            </p>
          </div>
          <p class="shrink-0 text-right text-lg font-semibold tabular-nums">
            {{ formatMoney(account.balanceMinor) }}
          </p>
        </div>

        <div class="mt-3 flex flex-wrap gap-2">
          <button
            v-if="account.interestRateBp !== null"
            type="button"
            class="btn btn-ghost min-h-9 px-3 text-xs"
            @click="openSettle(account)"
          >
            结息
          </button>
          <button type="button" class="btn btn-ghost min-h-9 px-3 text-xs" @click="openEdit(account)">编辑</button>
          <button
            type="button"
            class="btn btn-ghost min-h-9 px-3 text-xs text-danger"
            @click="remove(account)"
          >
            删除
          </button>
        </div>
      </li>
    </ul>

    <p v-if="interestAccounts.length > 0" class="px-1 text-xs text-ink-3">
      计息账户共 {{ interestAccounts.length }} 个；每日 02:30 自动结息到期账户，也可随时手动结息（预览即入账金额）。
    </p>

    <AppModal :open="formOpen" :title="editingId ? '编辑账户' : '新建账户'" @close="formOpen = false">
      <form class="space-y-4" @submit.prevent="submit">
        <div>
          <label class="label" for="account-name">账户名称</label>
          <input id="account-name" v-model="form.name" class="field" maxlength="50" placeholder="招商银行储蓄卡" />
        </div>

        <div>
          <label class="label" for="account-type">账户类型</label>
          <AppSelect v-model="form.type" :options="ACCOUNT_TYPES.map((type) => ({ value: type, label: ACCOUNT_TYPE_LABELS[type] }))" />
        </div>

        <div v-if="!editingId">
          <label class="label" for="account-initial">初始余额（元）</label>
          <MoneyInput id="account-initial" v-model="form.initialYuan" placeholder="0.00" />
          <p class="mt-1 text-xs text-ink-3">应付款可填负数，如 -1200.00。</p>
        </div>

        <div class="rounded-xl border border-line p-3">
          <label class="flex items-center gap-3">
            <input v-model="form.interestEnabled" type="checkbox" class="size-5 accent-brand" />
            <span class="text-sm font-medium">按年化利率自动结息</span>
          </label>

          <div v-if="form.interestEnabled" class="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label class="label" for="account-rate">年化利率（%）</label>
              <input
                id="account-rate"
                v-model="form.ratePercent"
                class="field"
                inputmode="decimal"
                placeholder="1.75"
              />
            </div>
            <div>
              <label class="label" for="account-freq">结息周期</label>
              <AppSelect v-model="form.freq" :options="INTEREST_FREQS.map((freq) => ({ value: freq, label: FREQ_LABELS[freq] }))" />
            </div>
          </div>
          <p v-if="form.interestEnabled" class="mt-2 text-xs text-ink-3">
            单利按日计息，区间为「上次结息日 + 1 ~ 今天」，按 Σ(每日余额 × 年化 ÷ 365) 计算。
          </p>
        </div>

        <p v-if="errorText" class="form-error">{{ errorText }}</p>

        <div class="flex gap-3">
          <button type="button" class="btn btn-ghost flex-1" @click="formOpen = false">取消</button>
          <button type="submit" class="btn btn-primary flex-1" :disabled="saving">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </form>
    </AppModal>

    <AppModal :open="settleTarget !== null" title="结息预览" @close="settleTarget = null">
      <div v-if="settlePreview" class="space-y-3 text-sm">
        <p class="text-ink-2">
          {{ settleTarget?.name }} · 区间 {{ settlePreview.from }} ~ {{ settlePreview.to }}
          （{{ settlePreview.days }} 天）
        </p>
        <div class="rounded-xl bg-brand-soft p-4">
          <p class="text-xs text-ink-2">应计利息</p>
          <p class="mt-1 text-2xl font-semibold tabular-nums text-brand">
            {{ formatMoney(settlePreview.interestMinor) }}
          </p>
          <p class="mt-1 text-xs text-ink-3">
            区间日均余额 {{ formatMoney(settlePreview.averageBalanceMinor) }} · 下次到期
            {{ settlePreview.nextDueAt }}
          </p>
        </div>
        <p class="text-xs text-ink-3">
          确认后写入一笔「利息收益」收入流水，余额随之增加；同一天重复提交不会重复入账。
        </p>
      </div>
      <p v-else-if="settleError" class="form-error">{{ settleError }}</p>
      <p v-else class="text-sm text-ink-3">正在计算…</p>

      <div class="mt-4 flex gap-3">
        <button type="button" class="btn btn-ghost flex-1" @click="settleTarget = null">取消</button>
        <button
          type="button"
          class="btn btn-primary flex-1"
          :disabled="saving || !settlePreview || settlePreview.interestMinor <= 0"
          @click="confirmSettle"
        >
          {{ saving ? '入账中…' : '确认入账' }}
        </button>
      </div>
    </AppModal>
  </section>
</template>
