<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ITEM_STATUSES, toMinor, toYuan, type ItemStatus } from '@itemlife/shared';
import { itemsApi } from '@/api/items';
import { ApiError } from '@/api/http';
import { useLedgerStore } from '@/stores/ledger';
import { useDomainStore } from '@/stores/domain';
import AppSelect from '@/components/AppSelect.vue';

const STATUS_LABELS: Record<ItemStatus, string> = {
  in_use: '在役',
  idle: '闲置',
  retired: '退役',
  lost: '遗失',
};

interface BatchRow {
  name: string;
  unitYuan: string;
  totalQty: string;
  usedQty: string;
}

const route = useRoute();
const router = useRouter();
const ledger = useLedgerStore();
const domain = useDomainStore();

const editingId = ref<string | null>(null);
const isEdit = computed(() => editingId.value !== null);
const priceFromLedger = ref(false);

const form = reactive({
  name: '',
  categoryId: '',
  purchaseDate: new Date().toISOString().slice(0, 10),
  priceYuan: '',
  expectedLifespanDays: '',
  status: 'in_use' as ItemStatus,
  note: '',
});

/** 配件批次只在新建时随物品一起入库；后续增删改在详情页操作。 */
const batches = ref<BatchRow[]>([]);

const loading = ref(false);
const saving = ref(false);
const errorText = ref<string | null>(null);

const categoryOptions = computed(() =>
  ledger.expenseCategories.flatMap((node) => [node, ...node.children.filter((child) => child.archivedAt === null)]),
);

function addBatch(): void {
  batches.value = [...batches.value, { name: '', unitYuan: '', totalQty: '1', usedQty: '0' }];
}

function removeBatch(index: number): void {
  batches.value = batches.value.filter((_, position) => position !== index);
}

async function loadForEdit(id: string): Promise<void> {
  loading.value = true;
  try {
    const detail = await itemsApi.detail(id);
    const inActiveDomain = detail.owner.type === domain.owner.type
      && (detail.owner.type === 'user' || detail.owner.id === domain.owner.id);
    if (!inActiveDomain) {
      await router.replace({ name: 'items' });
      return;
    }
    const bodyAllocations = detail.transactions.flatMap((transaction) =>
      transaction.items
        .filter((row) => row.itemId === detail.id && row.role === 'body')
        .map((row) => row.amountMinor ?? transaction.amountMinor),
    );
    priceFromLedger.value = bodyAllocations.length > 0;
    editingId.value = id;
    Object.assign(form, {
      name: detail.name,
      categoryId: detail.categoryId ?? '',
      purchaseDate: detail.purchaseDate,
      priceYuan: toYuan(priceFromLedger.value ? bodyAllocations.reduce((sum, amount) => sum + amount, 0) : detail.purchasePriceMinor),
      expectedLifespanDays: detail.expectedLifespanDays === null ? '' : String(detail.expectedLifespanDays),
      status: detail.status,
      note: detail.note ?? '',
    });
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '物品加载失败，请重试';
  } finally {
    loading.value = false;
  }
}

async function submit(): Promise<void> {
  errorText.value = null;
  const name = form.name.trim();
  if (!name) {
    errorText.value = '请填写物品名称';
    return;
  }

  let purchasePriceMinor: number;
  try {
    purchasePriceMinor = toMinor(form.priceYuan || '0');
  } catch {
    errorText.value = '本体价格式不正确（最多两位小数）';
    return;
  }
  if (purchasePriceMinor < 0) {
    errorText.value = '本体价不能为负';
    return;
  }

  const lifespan = form.expectedLifespanDays.trim();
  if (lifespan && (!Number.isInteger(Number(lifespan)) || Number(lifespan) <= 0)) {
    errorText.value = '预期寿命需为正整数天数';
    return;
  }

  const payloadBatches: Array<{ name: string; unitPriceMinor: number; totalQty: number; usedQty: number }> = [];
  for (const row of batches.value) {
    if (!row.name.trim() && !row.unitYuan.trim()) continue; // 空行忽略
    if (!row.name.trim()) {
      errorText.value = '配件名称不能为空';
      return;
    }
    let unitPriceMinor: number;
    try {
      unitPriceMinor = toMinor(row.unitYuan || '0');
    } catch {
      errorText.value = `配件「${row.name}」单价格式不正确`;
      return;
    }
    const totalQty = Number(row.totalQty);
    const usedQty = Number(row.usedQty || '0');
    if (!Number.isInteger(totalQty) || totalQty <= 0) {
      errorText.value = `配件「${row.name}」数量需为正整数`;
      return;
    }
    if (!Number.isInteger(usedQty) || usedQty < 0 || usedQty > totalQty) {
      errorText.value = `配件「${row.name}」已用数量需在 0 ~ ${totalQty} 之间`;
      return;
    }
    payloadBatches.push({ name: row.name.trim(), unitPriceMinor, totalQty, usedQty });
  }

  saving.value = true;
  try {
    if (editingId.value) {
      await itemsApi.update(editingId.value, {
        name,
        categoryId: form.categoryId || null,
        purchaseDate: form.purchaseDate,
        ...(!priceFromLedger.value ? { purchasePriceMinor } : {}),
        expectedLifespanDays: lifespan ? Number(lifespan) : null,
        status: form.status,
        note: form.note.trim() || null,
      });
      await router.push({ name: 'item-detail', params: { id: editingId.value } });
    } else {
      const created = await itemsApi.create({
        name,
        purchaseDate: form.purchaseDate,
        purchasePriceMinor,
        ...(form.categoryId ? { categoryId: form.categoryId } : {}),
        ...(lifespan ? { expectedLifespanDays: Number(lifespan) } : {}),
        status: form.status,
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
        ...(payloadBatches.length > 0 ? { accessories: payloadBatches } : {}),
        owner: domain.owner,
      });
      await router.push({ name: 'item-detail', params: { id: created.id } });
    }
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '保存失败，请重试';
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await ledger.refresh().catch(() => undefined);
  const id = route.params.id;
  if (typeof id === 'string' && id) {
    await loadForEdit(id);
  } else {
    addBatch();
  }
});
</script>

<template>
  <section class="space-y-4">
    <header class="card p-5">
      <h1 class="text-lg font-semibold">{{ isEdit ? '编辑物品' : '录入物品' }}</h1>
      <p class="mt-1 text-xs text-ink-3">
        已关联流水的价格由流水统一维护；这里管理物品资料与未关联流水时的回退价。
      </p>
    </header>

    <form class="card space-y-4 p-5" @submit.prevent="submit">
      <div>
        <label class="label" for="item-name">物品名称</label>
        <input id="item-name" v-model="form.name" class="field" maxlength="100" placeholder="电动牙刷" />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label" for="item-price">本体价（元）</label>
          <input
            id="item-price"
            v-model="form.priceYuan"
            class="field tabular-nums"
            inputmode="decimal"
            placeholder="400.00"
            :disabled="priceFromLedger"
          />
          <p v-if="priceFromLedger" class="mt-1 text-xs text-ink-3">来自关联流水，请在流水的“查看与编辑”中改价。</p>
        </div>
        <div>
          <label class="label" for="item-date">购买日期</label>
          <input id="item-date" v-model="form.purchaseDate" type="date" class="field" />
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="label" for="item-category">分类（可选）</label>
          <AppSelect v-model="form.categoryId" :options="[{ value: '', label: '不分类' }, ...categoryOptions.map((node) => ({ value: node.id, label: node.name }))]" />
        </div>
        <div>
          <label class="label" for="item-lifespan">预期寿命（天，可选）</label>
          <input
            id="item-lifespan"
            v-model="form.expectedLifespanDays"
            class="field tabular-nums"
            inputmode="numeric"
            placeholder="400"
          />
          <p class="mt-1 text-xs text-ink-3">填了才有「预计日均成本 = 总支付 ÷ 寿命天数」。</p>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label" for="item-status">状态</label>
          <AppSelect v-model="form.status" :options="ITEM_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))" />
        </div>
        <div>
          <label class="label" for="item-note">备注（可选）</label>
          <input id="item-note" v-model="form.note" class="field" maxlength="200" placeholder="口腔护理" />
        </div>
      </div>

      <div v-if="!isEdit" class="rounded-xl border border-line p-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-medium">配件批次</p>
            <p class="mt-0.5 text-xs text-ink-3">
              如「替换刷头 12 个、单价 20 元、已用 2 个」；已用数量会写入使用审计。
            </p>
          </div>
          <button type="button" class="btn btn-ghost min-h-9 px-3 text-xs" @click="addBatch">添加批次</button>
        </div>

        <div v-if="batches.length === 0" class="mt-3 text-xs text-ink-3">暂未添加配件。</div>
        <div v-for="(row, index) in batches" :key="index" class="mt-3 grid gap-2 sm:grid-cols-[1.4fr_1fr_0.7fr_0.7fr_auto]">
          <input v-model="row.name" class="field" placeholder="替换刷头" maxlength="60" />
          <input v-model="row.unitYuan" class="field tabular-nums" inputmode="decimal" placeholder="单价 20.00" />
          <input v-model="row.totalQty" class="field tabular-nums" inputmode="numeric" placeholder="总数 12" />
          <input v-model="row.usedQty" class="field tabular-nums" inputmode="numeric" placeholder="已用 2" />
          <button
            type="button"
            class="btn btn-ghost min-h-11 px-3 text-xs text-danger"
            @click="removeBatch(index)"
          >
            移除
          </button>
        </div>
      </div>

      <p v-if="loading" class="text-sm text-ink-3">正在加载…</p>
      <p v-if="errorText" class="form-error">{{ errorText }}</p>

      <div class="flex gap-3">
        <button type="button" class="btn btn-ghost flex-1" @click="router.back()">取消</button>
        <button type="submit" class="btn btn-primary flex-1" :disabled="saving || loading">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </form>
  </section>
</template>
