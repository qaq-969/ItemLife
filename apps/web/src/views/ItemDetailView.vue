<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { formatMoney, toMinor, type ItemDetailDto, type ItemStatus, type TransactionDto } from '@itemlife/shared';
import { itemsApi } from '@/api/items';
import { ApiError } from '@/api/http';
import AppModal from '@/components/AppModal.vue';
import { init, use, type ECharts } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

const STATUS_LABELS: Record<ItemStatus, string> = {
  in_use: '在役',
  idle: '闲置',
  retired: '退役',
  lost: '遗失',
};

const route = useRoute();
const router = useRouter();

const detail = ref<ItemDetailDto | null>(null);
const loading = ref(true);
const busy = ref(false);
const errorText = ref<string | null>(null);
const message = ref<string | null>(null);

/** 每个批次行独立的消耗数量，默认 1 */
const qty = reactive<Record<string, string>>({});

const batchOpen = ref(false);
const batchForm = reactive({
  name: '',
  unitYuan: '',
  totalQty: '1',
  usedQty: '0',
  purchasedAt: new Date().toISOString().slice(0, 10),
});

const chartEl = ref<HTMLDivElement | null>(null);
let chart: ECharts | null = null;

function showMessage(text: string): void {
  message.value = text;
  window.setTimeout(() => {
    if (message.value === text) message.value = null;
  }, 3_000);
}

async function load(): Promise<void> {
  const id = route.params.id;
  if (typeof id !== 'string' || !id) return;
  // 只有首次进入才显示整页 loading：刷新数据时保持挂载，图表实例才不会与 DOM 失联
  if (detail.value === null) loading.value = true;
  errorText.value = null;
  try {
    detail.value = await itemsApi.detail(id);
    for (const accessory of detail.value.accessories) {
      qty[accessory.id] ??= '1';
    }
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '物品加载失败，请重试';
    return;
  } finally {
    loading.value = false;
  }
  // 图表容器在 loading 关掉后才挂载，必须等 DOM 更新完再初始化
  await nextTick();
  renderChart();
}

/** 审计时间用本地时区展示（服务端返回 UTC ISO） */
function timeLabel(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 一笔流水分摊到多件物品时，只显示属于本物品的那一份 */
function amountLabel(transaction: TransactionDto): string {
  const links = transaction.items ?? [];
  const mine = links.filter((row) => row.itemId === detail.value?.id && row.role !== 'link');
  const total = mine.reduce((sum, row) => sum + (row.amountMinor ?? transaction.amountMinor), 0);
  return `${formatMoney(total)} / ${mine.length || 1} 项`;
}

function transactionLines(transaction: TransactionDto): string {
  return transaction.items
    .filter((row) => row.itemId === detail.value?.id)
    .map((row) => `${row.name}${row.role === 'link' ? '' : ` ${formatMoney(row.amountMinor ?? transaction.amountMinor)}`}`)
    .join(' · ');
}

/** 台阶式折线：横轴日期、纵轴当日结束时的累计持有成本。 */
function renderChart(): void {
  const points = detail.value?.costTimeline ?? [];
  if (!chartEl.value || points.length === 0) return;

  if (chart && chart.getDom() !== chartEl.value) {
    chart.dispose();
    chart = null;
  }
  chart ??= init(chartEl.value);
  chart.setOption({
    grid: { left: 4, right: 16, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: unknown) => formatMoney(Math.round(Number(value) * 100)),
    },
    xAxis: { type: 'category', boundaryGap: false, data: points.map((point) => point.date) },
    yAxis: {
      type: 'value',
      min: 0,
      axisLabel: { formatter: (value: number) => `¥${value}` },
      splitLine: { lineStyle: { color: '#eef1f5' } },
    },
    series: [
      {
        type: 'line',
        step: 'end',
        symbol: 'circle',
        symbolSize: 6,
        data: points.map((point) => point.holdCostMinor / 100),
        itemStyle: { color: '#4f46e5' },
        lineStyle: { width: 2, color: '#4f46e5' },
        areaStyle: { color: 'rgba(79, 70, 229, 0.12)' },
      },
    ],
  });
  chart.resize();
}

function handleResize(): void {
  chart?.resize();
}

async function guard(action: () => Promise<unknown>, successText: string): Promise<void> {
  busy.value = true;
  errorText.value = null;
  try {
    await action();
    showMessage(successText);
    await load();
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '操作失败，请重试';
  } finally {
    busy.value = false;
  }
}

function parseQty(accessoryId: string): number | null {
  const value = Number(qty[accessoryId] ?? '1');
  return Number.isInteger(value) && value >= 1 ? value : null;
}

function consume(accessoryId: string): void {
  const amount = parseQty(accessoryId);
  if (amount === null) {
    errorText.value = '使用数量需为不小于 1 的整数';
    return;
  }
  void guard(() => itemsApi.consume(accessoryId, amount), `已使用 ${amount} 个`);
}

function restore(accessoryId: string): void {
  const amount = parseQty(accessoryId);
  if (amount === null) {
    errorText.value = '撤销数量需为不小于 1 的整数';
    return;
  }
  void guard(() => itemsApi.restore(accessoryId, amount), `已撤销 ${amount} 个`);
}

function removeAccessory(accessoryId: string, name: string): void {
  const reason = window.prompt(`撤销配件「${name}」会保留采购流水。请填写原因：`);
  if (!reason?.trim()) return;
  void guard(() => itemsApi.removeAccessory(accessoryId, { reason: reason.trim() }), '已生成配件撤销记录');
}

function submitBatch(): void {
  const item = detail.value;
  if (!item) return;
  errorText.value = null;

  const name = batchForm.name.trim();
  if (!name) {
    errorText.value = '请填写配件名称';
    return;
  }
  let unitPriceMinor: number;
  try {
    unitPriceMinor = toMinor(batchForm.unitYuan || '0');
  } catch {
    errorText.value = '单价格式不正确（最多两位小数）';
    return;
  }
  const totalQty = Number(batchForm.totalQty);
  const usedQty = Number(batchForm.usedQty || '0');
  if (!Number.isInteger(totalQty) || totalQty <= 0) {
    errorText.value = '数量需为正整数';
    return;
  }
  if (!Number.isInteger(usedQty) || usedQty < 0 || usedQty > totalQty) {
    errorText.value = `已用数量需在 0 ~ ${totalQty} 之间`;
    return;
  }

  batchOpen.value = false;
  void guard(
    () =>
      itemsApi.addAccessory(item.id, {
        name,
        unitPriceMinor,
        totalQty,
        usedQty,
        purchasedAt: batchForm.purchasedAt,
      }),
    '配件批次已入库',
  ).then(() => {
    Object.assign(batchForm, {
      name: '',
      unitYuan: '',
      totalQty: '1',
      usedQty: '0',
      purchasedAt: new Date().toISOString().slice(0, 10),
    });
  });
}

function removeItem(): void {
  const item = detail.value;
  if (!item) return;
  const reason = window.prompt(
    `删除物品「${item.name}」会同步移除 ${item.transactions.length} 笔关联流水中的对应物品、配件和费用；共享流水会自动扣减金额，减为 0 时整笔删除。请填写原因：`,
  );
  if (!reason?.trim()) return;
  void (async () => {
    try {
      await itemsApi.remove(item.id, { reason: reason.trim() });
      await router.push({ name: 'items' });
    } catch (error) {
      errorText.value = error instanceof ApiError ? error.message : '删除失败，请重试';
    }
  })();
}

const cost = computed(() => detail.value?.cost ?? null);
const bodyPriceMinor = computed(() => {
  const item = detail.value;
  if (!item) return 0;
  const bodyRows = item.transactions.flatMap((transaction) =>
    transaction.items
      .filter((row) => row.itemId === item.id && row.role === 'body')
      .map((row) => row.amountMinor ?? transaction.amountMinor),
  );
  return bodyRows.length > 0 ? bodyRows.reduce((sum, amount) => sum + amount, 0) : item.purchasePriceMinor;
});

onMounted(() => {
  window.addEventListener('resize', handleResize);
  void load();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <section class="space-y-4">
    <p v-if="loading" class="card p-5 text-sm text-ink-3">正在加载…</p>
    <p v-else-if="!detail" class="card p-5 text-sm text-ink-3">
      {{ errorText ?? '物品不存在或已删除。' }}
      <RouterLink :to="{ name: 'items' }" class="ml-2 text-brand">返回列表</RouterLink>
    </p>

    <template v-else>
      <header class="card p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="truncate text-lg font-semibold">{{ detail.name }}</h1>
              <span
                class="shrink-0 rounded px-2 py-0.5 text-xs"
                :class="detail.status === 'in_use' ? 'bg-ok-soft text-ok' : 'bg-slate-100 text-ink-3'"
              >
                {{ STATUS_LABELS[detail.status] }}
              </span>
              <span v-if="detail.category" class="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs text-ink-3">
                {{ detail.category.name }}
              </span>
            </div>
            <p class="mt-1 text-xs text-ink-3">
              {{ detail.purchaseDate }} 购入 · 已持有 {{ detail.cost.heldDays }} 天
              <span v-if="detail.note">· {{ detail.note }}</span>
            </p>
          </div>
          <div class="flex gap-2">
            <RouterLink :to="{ name: 'item-edit', params: { id: detail.id } }" class="btn btn-ghost min-h-9 px-3 text-xs">
              编辑
            </RouterLink>
            <button type="button" class="btn btn-ghost min-h-9 px-3 text-xs text-danger" @click="removeItem">
              删除
            </button>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div class="rounded-xl bg-brand-soft p-3">
            <p class="text-xs text-ink-2">当前持有成本</p>
            <p class="mt-1 text-xl font-semibold tabular-nums text-brand">
              {{ formatMoney(cost?.holdCostMinor ?? 0) }}
            </p>
            <p class="mt-0.5 text-xs text-ink-3">本体 + 已用配件</p>
          </div>
          <div class="rounded-xl bg-slate-50 p-3">
            <p class="text-xs text-ink-2">总支付金额</p>
            <p class="mt-1 text-xl font-semibold tabular-nums">{{ formatMoney(cost?.payTotalMinor ?? 0) }}</p>
            <p class="mt-0.5 text-xs text-ink-3">本体 + 全部配件</p>
          </div>
          <div class="rounded-xl bg-slate-50 p-3">
            <p class="text-xs text-ink-2">日均持有成本</p>
            <p class="mt-1 text-xl font-semibold tabular-nums">
              {{ formatMoney(cost?.dailyHoldCostMinor ?? 0) }}
            </p>
            <p class="mt-0.5 text-xs text-ink-3">持有成本 ÷ {{ detail.cost.heldDays }} 天</p>
          </div>
          <div class="rounded-xl bg-slate-50 p-3">
            <p class="text-xs text-ink-2">配件库存价值</p>
            <p class="mt-1 text-xl font-semibold tabular-nums">
              {{ formatMoney(cost?.remainingStockMinor ?? 0) }}
            </p>
            <p class="mt-0.5 text-xs text-ink-3">未使用的配件</p>
          </div>
          <div class="rounded-xl bg-slate-50 p-3">
            <p class="text-xs text-ink-2">本体价</p>
            <p class="mt-1 text-xl font-semibold tabular-nums">{{ formatMoney(bodyPriceMinor) }}</p>
            <p class="mt-0.5 text-xs text-ink-3">{{ detail.transactions.length ? '来自关联流水' : '未关联流水的回退价' }}</p>
          </div>
          <div class="rounded-xl bg-slate-50 p-3">
            <p class="text-xs text-ink-2">预计日均成本</p>
            <p class="mt-1 text-xl font-semibold tabular-nums">
              {{ cost?.projectedDailyMinor === null ? '—' : formatMoney(cost?.projectedDailyMinor ?? 0) }}
            </p>
            <p class="mt-0.5 text-xs text-ink-3">
              {{ detail.expectedLifespanDays ? `预期寿命 ${detail.expectedLifespanDays} 天` : '未填预期寿命' }}
            </p>
          </div>
        </div>
      </header>

      <p v-if="message" class="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{{ message }}</p>
      <p v-if="errorText" class="form-error">{{ errorText }}</p>

      <section class="card p-5">
        <h2 class="text-sm font-semibold">成本演进</h2>
        <p class="mt-1 text-xs text-ink-3">
          每次使用配件按批次单价抬升持有成本，撤销则回落；台阶高度就是一次消耗带来的成本。
        </p>
        <div ref="chartEl" class="mt-3 h-56 w-full"></div>
      </section>

      <section v-if="detail.reverts.length" class="card p-5">
        <h2 class="text-sm font-semibold">库存撤销记录</h2>
        <p class="mt-1 text-xs text-ink-3">每次移除库存都保留原因与原始购买流水。</p>
        <ul class="mt-3 divide-y divide-line">
          <li v-for="revert in detail.reverts" :key="revert.id" class="py-2 text-sm">
            <span>{{ timeLabel(revert.createdAt) }} · {{ revert.kind === 'correction' ? '更正' : '报废/移除' }}{{ revert.qty === null ? '' : ` ${revert.qty} 个` }} · {{ revert.reason }}</span>
            <RouterLink v-if="revert.sourceTransactionId" :to="{ name: 'transactions', query: { itemId: detail.id } }" class="ml-2 text-xs text-brand">关联流水</RouterLink>
          </li>
        </ul>
      </section>

      <section class="card p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold">配件库存</h2>
            <p class="mt-1 text-xs text-ink-3">同一物品可分批入库，成本按各批次单价分别计算。</p>
          </div>
          <button type="button" class="btn btn-ghost min-h-9 px-3 text-xs" @click="batchOpen = true">
            添加批次
          </button>
        </div>

        <p v-if="detail.accessories.length === 0" class="mt-3 text-sm text-ink-3">还没有配件批次。</p>

        <ul v-else class="mt-3 space-y-3">
          <li v-for="accessory in detail.accessories" :key="accessory.id" class="rounded-xl border border-line p-3">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate font-medium">{{ accessory.name }}</p>
                <p class="mt-0.5 text-xs text-ink-3">
                  {{ formatMoney(accessory.unitPriceMinor) }}/个 · {{ accessory.purchasedAt }} 入库
                  <span v-if="accessory.transactionId">· 已关联购买流水</span>
                </p>
              </div>
              <p class="shrink-0 text-sm tabular-nums">
                已用 {{ accessory.usedQty }} / {{ accessory.totalQty }}
                <span class="text-ink-3">· 余 {{ accessory.remainingQty }}</span>
              </p>
            </div>

            <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                class="h-full rounded-full bg-brand"
                :style="{ width: `${accessory.totalQty > 0 ? (accessory.usedQty / accessory.totalQty) * 100 : 0}%` }"
              ></div>
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-2">
              <input
                v-model="qty[accessory.id]"
                class="field w-20 text-center tabular-nums"
                inputmode="numeric"
                aria-label="数量"
              />
              <button
                type="button"
                class="btn btn-primary min-h-9 px-3 text-xs"
                :disabled="busy || accessory.remainingQty === 0"
                @click="consume(accessory.id)"
              >
                使用
              </button>
              <button
                type="button"
                class="btn btn-ghost min-h-9 px-3 text-xs"
                :disabled="busy || accessory.usedQty === 0"
                @click="restore(accessory.id)"
              >
                撤销
              </button>
              <button
                type="button"
                class="btn btn-ghost min-h-9 px-3 text-xs text-danger"
                :disabled="busy"
                @click="removeAccessory(accessory.id, accessory.name)"
              >
                删除批次
              </button>
              <span class="text-xs text-ink-3">
                库存价值 {{ formatMoney(accessory.unitPriceMinor * accessory.remainingQty) }} · 已计入持有成本
                {{ formatMoney(accessory.unitPriceMinor * accessory.usedQty) }}
              </span>
            </div>
          </li>
        </ul>
      </section>

      <section class="card p-5">
        <h2 class="text-sm font-semibold">使用记录（审计）</h2>
        <p class="mt-1 text-xs text-ink-3">每次「使用 / 撤销」都留痕，可按时间线还原持有成本。</p>
        <p v-if="detail.usages.length === 0" class="mt-3 text-sm text-ink-3">暂无使用记录。</p>
        <ul v-else class="mt-3 divide-y divide-line">
          <li v-for="usage in detail.usages" :key="usage.id" class="flex items-center justify-between gap-3 py-2 text-sm">
            <span class="min-w-0 truncate">
              {{ usage.accessoryName }}
              <span class="text-xs text-ink-3">· {{ usage.actorName ?? '系统' }}</span>
            </span>
            <span class="shrink-0 tabular-nums" :class="usage.deltaQty > 0 ? 'text-ink' : 'text-ok'">
              {{ usage.deltaQty > 0 ? `使用 ${usage.deltaQty}` : `撤销 ${-usage.deltaQty}` }}
              <span class="text-xs text-ink-3">（余 {{ usage.usedQtyAfter }}）</span>
            </span>
            <span class="shrink-0 text-xs text-ink-3">{{ timeLabel(usage.createdAt) }}</span>
          </li>
        </ul>
      </section>

      <section class="card p-5">
        <h2 class="text-sm font-semibold">关联流水</h2>
        <p class="mt-1 text-xs text-ink-3">流水是购买金额来源；物品、配件名称与价格会在两页保持一致。</p>
        <p v-if="detail.transactions.length === 0" class="mt-3 text-sm text-ink-3">
          还没有关联流水。在「记一笔」里选择本物品即可分摊。
        </p>
        <ul v-else class="mt-3 divide-y divide-line">
          <li
            v-for="transaction in detail.transactions"
            :key="transaction.id"
            class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
          >
            <span class="min-w-0 flex-1 truncate">
              {{ transaction.category?.name ?? (transaction.type === 'income' ? '收入' : '支出') }}
              <span class="text-xs text-ink-3"> · {{ transaction.account.name }}</span>
              <span v-if="transaction.note" class="text-xs text-ink-3"> · {{ transaction.note }}</span>
              <span class="mt-0.5 block truncate text-xs text-brand">{{ transactionLines(transaction) }}</span>
            </span>
            <span
              class="shrink-0 tabular-nums"
              :class="transaction.type === 'income' ? 'text-ok' : 'text-ink'"
            >
              {{ transaction.type === 'income' ? '+' : '−' }}{{ amountLabel(transaction) }}
            </span>
            <span class="shrink-0 text-xs text-ink-3">{{ timeLabel(transaction.occurredAt) }}</span>
            <RouterLink
              :to="{ name: 'transactions', query: { itemId: detail.id, edit: transaction.id, from: transaction.occurredAt.slice(0, 10), to: transaction.occurredAt.slice(0, 10) } }"
              class="btn btn-ghost min-h-8 px-2 text-xs"
            >编辑明细</RouterLink>
          </li>
        </ul>
      </section>
    </template>

    <AppModal :open="batchOpen" title="添加配件批次" @close="batchOpen = false">
      <form class="space-y-4" @submit.prevent="submitBatch">
        <div>
          <label class="label" for="batch-name">配件名称</label>
          <input id="batch-name" v-model="batchForm.name" class="field" maxlength="60" placeholder="替换刷头" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="batch-price">单价（元）</label>
            <input id="batch-price" v-model="batchForm.unitYuan" class="field tabular-nums" inputmode="decimal" placeholder="20.00" />
          </div>
          <div>
            <label class="label" for="batch-date">购入日期</label>
            <input id="batch-date" v-model="batchForm.purchasedAt" type="date" class="field" />
          </div>
          <div>
            <label class="label" for="batch-total">数量</label>
            <input id="batch-total" v-model="batchForm.totalQty" class="field tabular-nums" inputmode="numeric" />
          </div>
          <div>
            <label class="label" for="batch-used">已用数量</label>
            <input id="batch-used" v-model="batchForm.usedQty" class="field tabular-nums" inputmode="numeric" />
          </div>
        </div>
        <p class="text-xs text-ink-3">已用数量 &gt; 0 时会补一条使用审计，成本指标随即抬升。</p>

        <div class="flex gap-3">
          <button type="button" class="btn btn-ghost flex-1" @click="batchOpen = false">取消</button>
          <button type="submit" class="btn btn-primary flex-1" :disabled="busy">入库</button>
        </div>
      </form>
    </AppModal>
  </section>
</template>
