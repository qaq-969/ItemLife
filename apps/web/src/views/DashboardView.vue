<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { formatMoney, type DashboardBreakdownDto, type DashboardGranularity, type DashboardOverviewDto, type DashboardTrendDto, type TransactionDto } from '@itemlife/shared';
import type { ECharts } from 'echarts';
import { dashboardApi } from '@/api/dashboard';
import { transactionsApi } from '@/api/ledger';
import { ApiError } from '@/api/http';
import AppSelect from '@/components/AppSelect.vue';
import { useDomainStore } from '@/stores/domain';
import { useCachedPage } from '@/utils/cached-page';

const domain = useDomainStore();
const period = ref('month');
const granularity = ref<DashboardGranularity>('day');
const overview = ref<DashboardOverviewDto | null>(null);
const trend = ref<DashboardTrendDto | null>(null);
const breakdown = ref<DashboardBreakdownDto | null>(null);
const recent = ref<TransactionDto[]>([]);
const loading = ref(false);
const errorText = ref<string | null>(null);
const trendEl = ref<HTMLDivElement | null>(null);
const categoryEl = ref<HTMLDivElement | null>(null);
let trendChart: ECharts | null = null;
let categoryChart: ECharts | null = null;

const periodOptions = [
  { value: 'month', label: '本月' },
  { value: '3months', label: '近 3 个月' },
  { value: '12months', label: '近 12 个月' },
];
const granularityOptions = [
  { value: 'day', label: '按日' }, { value: 'week', label: '按周' }, { value: 'month', label: '按月' },
];

const cards = computed(() => [
  { label: '消费', value: overview.value?.expenseMinor ?? 0, tone: 'text-ink', compare: overview.value?.expenseComparison.changePercent, reverse: true },
  { label: '储蓄', value: overview.value?.savingMinor ?? 0, tone: 'text-ok', compare: overview.value?.savingComparison.changePercent, reverse: false },
  { label: '收益', value: overview.value?.returnMinor ?? 0, tone: 'text-warn', compare: null, reverse: false },
  { label: '总资产', value: overview.value?.netWorthMinor ?? 0, tone: 'text-brand', compare: null, reverse: false },
]);

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function range(): { from: string; to: string } {
  const today = new Date();
  const months = period.value === '12months' ? 11 : period.value === '3months' ? 2 : 0;
  return { from: isoDay(new Date(today.getFullYear(), today.getMonth() - months, 1)), to: isoDay(today) };
}
function changeLabel(value: number | null | undefined, reverse: boolean): string {
  if (value === null || value === undefined) return '暂无上期基线';
  const favorable = reverse ? value <= 0 : value >= 0;
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}% ${favorable ? '较好' : '需关注'}`;
}
function transactionAmount(row: TransactionDto): string {
  const positive = row.type === 'income' || row.type === 'transfer_in';
  return `${positive ? '+' : '-'}${formatMoney(row.amountMinor)}`;
}

async function load(): Promise<void> {
  loading.value = true; errorText.value = null;
  const dates = range();
  const query = { ...dates, domain: domain.query, granularity: granularity.value };
  try {
    const [summary, series, pieces, latest] = await Promise.all([
      dashboardApi.overview(query), dashboardApi.trend(query), dashboardApi.breakdown(query),
      transactionsApi.list({ domain: domain.query, limit: 5 }),
    ]);
    overview.value = summary; trend.value = series; breakdown.value = pieces; recent.value = latest.items;
    await nextTick(); await renderCharts();
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '看板加载失败，请重试';
  } finally { loading.value = false; }
}

async function renderCharts(): Promise<void> {
  const echarts = await import('echarts');
  if (trendEl.value) {
    trendChart ??= echarts.init(trendEl.value);
    const points = trend.value?.points ?? [];
    trendChart.setOption({
      animationDuration: 240,
      color: ['#059669', '#ef4444', '#4f46e5'],
      grid: { left: 8, right: 12, top: 34, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => formatMoney(Math.round(Number(value) * 100)) },
      legend: { top: 0, data: ['收入', '支出', '总资产'] },
      xAxis: { type: 'category', boundaryGap: false, data: points.map((row) => row.period), axisLabel: { hideOverlap: true } },
      yAxis: { type: 'value', axisLabel: { formatter: (value: number) => `¥${Math.round(value)}` }, splitLine: { lineStyle: { color: '#eef1f5' } } },
      series: [
        { name: '收入', type: 'line', smooth: true, symbolSize: 6, data: points.map((row) => row.incomeMinor / 100) },
        { name: '支出', type: 'line', smooth: true, symbolSize: 6, data: points.map((row) => row.expenseMinor / 100) },
        { name: '总资产', type: 'line', smooth: true, symbolSize: 6, data: points.map((row) => row.netWorthMinor / 100) },
      ],
    }, true);
  }
  if (categoryEl.value) {
    categoryChart ??= echarts.init(categoryEl.value);
    const rows = breakdown.value?.categories ?? [];
    categoryChart.setOption({
      animationDuration: 240,
      tooltip: { trigger: 'item', formatter: (item: { name: string; value: number; percent: number }) => `${item.name}<br>${formatMoney(Math.round(item.value * 100))} · ${item.percent}%` },
      series: [{ type: 'pie', radius: ['50%', '76%'], center: ['50%', '48%'], minAngle: 3, itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { formatter: '{b}\n{d}%', fontSize: 11 }, data: rows.map((row) => ({ name: row.name, value: row.amountMinor / 100, itemStyle: { color: row.color ?? '#94a3b8' } })) }],
    }, true);
  }
}

function resizeCharts(): void { trendChart?.resize(); categoryChart?.resize(); }
watch([period, granularity], () => { void load(); });
onMounted(() => { window.addEventListener('resize', resizeCharts); void load(); });
onBeforeUnmount(() => { window.removeEventListener('resize', resizeCharts); trendChart?.dispose(); categoryChart?.dispose(); });
useCachedPage({ refresh: load });
</script>

<template>
  <section class="space-y-4">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div><h1 class="text-xl font-semibold">{{ domain.label }}看板</h1><p class="mt-1 text-sm text-ink-3">流水、账户余额与物品投入使用同一数据口径。</p></div>
      <div class="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-[140px_120px]">
        <AppSelect v-model="period" :options="periodOptions" />
        <AppSelect v-model="granularity" :options="granularityOptions" />
      </div>
    </header>
    <p v-if="errorText" class="form-error">{{ errorText }}</p>
    <p v-if="loading && !overview" class="card p-5 text-sm text-ink-3">正在汇总看板…</p>

    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <article v-for="card in cards" :key="card.label" class="card p-4">
        <p class="text-xs font-semibold text-ink-3">{{ card.label }}</p>
        <p class="mt-1 truncate text-xl font-semibold tabular-nums sm:text-2xl" :class="card.tone">{{ formatMoney(card.value) }}</p>
        <p v-if="card.compare !== null" class="mt-2 text-[11px] text-ink-3">{{ changeLabel(card.compare, card.reverse) }}</p>
      </article>
    </div>

    <div class="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <article class="card p-4"><div class="flex items-center justify-between"><h2 class="text-sm font-semibold">收支与总资产趋势</h2><span class="text-xs text-ink-3">{{ overview?.from }} 至 {{ overview?.to }}</span></div><div ref="trendEl" class="mt-3 h-64 w-full"></div></article>
      <article class="card p-4"><h2 class="text-sm font-semibold">支出分类占比</h2><div v-if="breakdown?.categories.length" ref="categoryEl" class="mt-3 h-64 w-full"></div><p v-else class="mt-6 text-sm text-ink-3">该区间没有支出。</p></article>
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      <article class="card p-4">
        <div class="flex items-center justify-between"><h2 class="text-sm font-semibold">物品投入</h2><RouterLink :to="{ name: 'items' }" class="text-xs font-semibold text-brand">查看物品 ›</RouterLink></div>
        <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div class="rounded-lg bg-slate-50 p-3"><p class="text-xs text-ink-3">累计支付</p><p class="mt-1 font-semibold tabular-nums">{{ formatMoney(overview?.itemInvestment.payTotalMinor ?? 0) }}</p></div>
          <div class="rounded-lg bg-slate-50 p-3"><p class="text-xs text-ink-3">当前持有</p><p class="mt-1 font-semibold tabular-nums">{{ formatMoney(overview?.itemInvestment.holdCostMinor ?? 0) }}</p></div>
          <div class="rounded-lg bg-slate-50 p-3"><p class="text-xs text-ink-3">配件库存</p><p class="mt-1 font-semibold tabular-nums">{{ formatMoney(overview?.itemInvestment.remainingStockMinor ?? 0) }}</p></div>
          <div class="rounded-lg bg-slate-50 p-3"><p class="text-xs text-ink-3">在役 / 在册</p><p class="mt-1 font-semibold">{{ overview?.itemInvestment.inUseCount ?? 0 }} / {{ overview?.itemInvestment.itemCount ?? 0 }} 件</p></div>
        </div>
      </article>

      <article class="card p-4">
        <div class="flex items-center justify-between"><h2 class="text-sm font-semibold">账户分布</h2><RouterLink :to="{ name: 'accounts' }" class="text-xs font-semibold text-brand">管理账户 ›</RouterLink></div>
        <ul v-if="breakdown?.accounts.length" class="mt-3 space-y-3">
          <li v-for="account in breakdown.accounts" :key="account.id">
            <div class="flex items-center justify-between gap-3 text-xs"><span class="truncate">{{ account.name }}</span><span class="shrink-0 tabular-nums">{{ formatMoney(account.balanceMinor) }} · {{ account.percent.toFixed(1) }}%</span></div>
            <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div class="h-full rounded-full bg-brand transition-[width] duration-300" :style="{ width: `${account.percent}%` }"></div></div>
          </li>
        </ul>
        <p v-else class="mt-6 text-sm text-ink-3">还没有账户。</p>
      </article>

      <article class="card p-4">
        <div class="flex items-center justify-between"><h2 class="text-sm font-semibold">近期流水</h2><RouterLink :to="{ name: 'transactions' }" class="text-xs font-semibold text-brand">全部流水 ›</RouterLink></div>
        <ul v-if="recent.length" class="mt-2 divide-y divide-line">
          <li v-for="row in recent" :key="row.id" class="flex min-h-11 items-center justify-between gap-3 py-2 text-sm"><div class="min-w-0"><p class="truncate">{{ row.category?.name || row.note || '未分类' }}</p><p class="text-xs text-ink-3">{{ new Date(row.occurredAt).toLocaleDateString() }} · {{ row.account.name }}</p></div><span class="shrink-0 font-medium tabular-nums" :class="row.type === 'income' ? 'text-ok' : ''">{{ transactionAmount(row) }}</span></li>
        </ul>
        <p v-else class="mt-6 text-sm text-ink-3">还没有流水。</p>
      </article>
    </div>

    <details class="card p-4 text-sm">
      <summary class="cursor-pointer font-semibold">图表数据表</summary>
      <div class="mt-3 overflow-x-auto"><table class="w-full min-w-[420px] text-left text-xs"><thead class="text-ink-3"><tr><th class="py-2">期间</th><th>收入</th><th>支出</th><th>总资产</th></tr></thead><tbody><tr v-for="row in trend?.points ?? []" :key="row.period" class="border-t border-line"><td class="py-2">{{ row.period }}</td><td>{{ formatMoney(row.incomeMinor) }}</td><td>{{ formatMoney(row.expenseMinor) }}</td><td>{{ formatMoney(row.netWorthMinor) }}</td></tr></tbody></table></div>
    </details>
  </section>
</template>
