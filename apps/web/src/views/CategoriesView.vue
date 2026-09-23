<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { CategoryDto, CategoryKind } from '@itemlife/shared';
import { categoriesApi, type CategoryOrderItem } from '@/api/ledger';
import { ApiError } from '@/api/http';
import { useLedgerStore } from '@/stores/ledger';
import AppModal from '@/components/AppModal.vue';

const KIND_LABELS: Record<CategoryKind, string> = { expense: '支出', income: '收入' };

const ledger = useLedgerStore();

const kind = ref<CategoryKind>('expense');
const includeArchived = ref(false);
const message = ref<string | null>(null);
const errorText = ref<string | null>(null);
const busy = ref(false);

const formOpen = ref(false);
const editingId = ref<string | null>(null);
const form = reactive({ name: '', parentId: '', color: '#6366f1' });

/** 按 kind 取树；同一父级下按 sortOrder 排序（后端已排序，这里防御性再排一次） */
const tree = computed(() => {
  const bySort = (left: CategoryDto, right: CategoryDto): number =>
    left.sortOrder - right.sortOrder || left.name.localeCompare(right.name);
  return ledger.categories
    .filter((node) => node.kind === kind.value)
    .map((node) => ({ ...node, children: [...node.children].sort(bySort) }))
    .sort(bySort);
});

const topLevelOptions = computed(() => tree.value.filter((node) => node.id !== editingId.value));

function showMessage(text: string): void {
  message.value = text;
  window.setTimeout(() => {
    if (message.value === text) message.value = null;
  }, 3_000);
}

function openCreate(parentId = ''): void {
  editingId.value = null;
  Object.assign(form, { name: '', parentId, color: '#6366f1' });
  errorText.value = null;
  formOpen.value = true;
}

function openEdit(node: CategoryDto): void {
  editingId.value = node.id;
  Object.assign(form, { name: node.name, parentId: node.parentId ?? '', color: node.color ?? '#6366f1' });
  errorText.value = null;
  formOpen.value = true;
}

async function submit(): Promise<void> {
  errorText.value = null;
  const name = form.name.trim();
  if (!name) {
    errorText.value = '请填写分类名称';
    return;
  }

  busy.value = true;
  try {
    if (editingId.value) {
      await categoriesApi.update(editingId.value, {
        name,
        color: form.color,
        parentId: form.parentId || null,
      });
      showMessage('分类已更新');
    } else {
      await categoriesApi.create({
        kind: kind.value,
        name,
        color: form.color,
        ...(form.parentId ? { parentId: form.parentId } : {}),
      });
      showMessage('分类已创建');
    }
    formOpen.value = false;
    await ledger.loadCategories(includeArchived.value);
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '保存失败，请重试';
  } finally {
    busy.value = false;
  }
}

/** 移动端排序：与相邻同类交换 sortOrder，再把该组的完整顺序提交（一次请求落库） */
async function move(node: CategoryDto, direction: -1 | 1): Promise<void> {
  const parent = node.parentId ? tree.value.find((item) => item.id === node.parentId) : null;
  const siblings = parent ? parent.children : tree.value;
  const index = siblings.findIndex((item) => item.id === node.id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= siblings.length) return;

  const reordered = [...siblings];
  [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
  const items: CategoryOrderItem[] = reordered.map((item, position) => ({
    id: item.id,
    sortOrder: position,
    ...(item.parentId ? { parentId: item.parentId } : {}),
  }));

  busy.value = true;
  errorText.value = null;
  try {
    await categoriesApi.reorder(items);
    await ledger.loadCategories(includeArchived.value);
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '排序失败，请重试';
  } finally {
    busy.value = false;
  }
}

async function toggleArchived(node: CategoryDto): Promise<void> {
  const next = node.archivedAt === null;
  if (next && node.children.length > 0 && !window.confirm('停用后其子分类一并停用，确认？')) return;
  busy.value = true;
  errorText.value = null;
  try {
    await categoriesApi.update(node.id, { archived: next });
    showMessage(next ? '分类已停用' : '分类已恢复');
    await ledger.loadCategories(includeArchived.value);
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '操作失败，请重试';
  } finally {
    busy.value = false;
  }
}

async function remove(node: CategoryDto): Promise<void> {
  if (node.isSystem || node.systemTag) {
    errorText.value = '系统分类（利息收益等）不可删除，只能停用';
    return;
  }
  if (!window.confirm(`删除分类「${node.name}」？有流水引用的分类不可删除。`)) return;
  busy.value = true;
  errorText.value = null;
  try {
    await categoriesApi.remove(node.id);
    showMessage('分类已删除');
    await ledger.loadCategories(includeArchived.value);
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '删除失败，请重试';
  } finally {
    busy.value = false;
  }
}

async function toggleIncludeArchived(): Promise<void> {
  await ledger.loadCategories(includeArchived.value);
}

onMounted(() => {
  void ledger.refresh().catch(() => undefined);
});
</script>

<template>
  <section class="space-y-4">
    <header class="card p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex rounded-lg border border-line p-1">
          <button
            v-for="(label, value) in KIND_LABELS"
            :key="value"
            type="button"
            class="min-h-9 rounded-md px-4 text-sm font-semibold"
            :class="kind === value ? 'bg-brand text-white' : 'text-ink-2'"
            @click="kind = value"
          >
            {{ label }}
          </button>
        </div>
        <button type="button" class="btn btn-primary" @click="openCreate()">新建分类</button>
      </div>
      <label class="mt-4 flex items-center gap-2 text-sm text-ink-2">
        <input
          v-model="includeArchived"
          type="checkbox"
          class="size-4 accent-brand"
          @change="toggleIncludeArchived"
        />
        显示已停用分类
      </label>
    </header>

    <p v-if="message" class="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{{ message }}</p>
    <p v-if="errorText" class="form-error">{{ errorText }}</p>

    <div v-if="tree.length === 0" class="card p-5 text-sm text-ink-3">
      该分组下还没有分类，点「新建分类」添加一个。
    </div>

    <ul v-else class="space-y-2">
      <li v-for="node in tree" :key="node.id" class="card overflow-hidden">
        <div class="flex items-center gap-3 p-3">
          <span class="size-3 shrink-0 rounded-full" :style="{ background: node.color ?? '#cbd5e1' }"></span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">
              {{ node.name }}
              <span v-if="node.archivedAt" class="ml-1 text-xs text-ink-3">（已停用）</span>
            </p>
            <p class="text-xs text-ink-3">
              {{ node.children.length }} 个子分类
              <span v-if="node.systemTag">· 系统分类</span>
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <button
              type="button"
              class="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-slate-100 disabled:opacity-40"
              :disabled="busy"
              aria-label="上移"
              @click="move(node, -1)"
            >
              <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6" /></svg>
            </button>
            <button
              type="button"
              class="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-slate-100 disabled:opacity-40"
              :disabled="busy"
              aria-label="下移"
              @click="move(node, 1)"
            >
              <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <button type="button" class="btn btn-ghost min-h-9 px-2 text-xs" @click="openEdit(node)">编辑</button>
            <button type="button" class="btn btn-ghost min-h-9 px-2 text-xs" @click="toggleArchived(node)">
              {{ node.archivedAt ? '恢复' : '停用' }}
            </button>
            <button
              v-if="!node.systemTag"
              type="button"
              class="btn btn-ghost min-h-9 px-2 text-xs text-danger"
              @click="remove(node)"
            >
              删除
            </button>
          </div>
        </div>

        <ul v-if="node.children.length > 0" class="border-t border-line bg-slate-50">
          <li v-for="child in node.children" :key="child.id" class="flex items-center gap-3 px-3 py-2 pl-8">
            <span class="size-2.5 shrink-0 rounded-full" :style="{ background: child.color ?? '#cbd5e1' }"></span>
            <p class="min-w-0 flex-1 truncate text-sm">
              {{ child.name }}
              <span v-if="child.archivedAt" class="text-xs text-ink-3">（已停用）</span>
            </p>
            <div class="flex shrink-0 items-center gap-1">
              <button
                type="button"
                class="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-white disabled:opacity-40"
                :disabled="busy"
                aria-label="上移"
                @click="move(child, -1)"
              >
                <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6" /></svg>
              </button>
              <button
                type="button"
                class="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-white disabled:opacity-40"
                :disabled="busy"
                aria-label="下移"
                @click="move(child, 1)"
              >
                <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              <button type="button" class="btn btn-ghost min-h-9 px-2 text-xs" @click="openEdit(child)">编辑</button>
              <button type="button" class="btn btn-ghost min-h-9 px-2 text-xs" @click="toggleArchived(child)">
                {{ child.archivedAt ? '恢复' : '停用' }}
              </button>
              <button type="button" class="btn btn-ghost min-h-9 px-2 text-xs text-danger" @click="remove(child)">
                删除
              </button>
            </div>
          </li>
        </ul>

        <button
          type="button"
          class="w-full border-t border-line px-3 py-2 text-left text-xs font-semibold text-brand"
          @click="openCreate(node.id)"
        >
          + 添加子分类
        </button>
      </li>
    </ul>

    <AppModal :open="formOpen" :title="editingId ? '编辑分类' : '新建分类'" @close="formOpen = false">
      <form class="space-y-4" @submit.prevent="submit">
        <div>
          <label class="label" for="category-name">名称</label>
          <input id="category-name" v-model="form.name" class="field" maxlength="30" placeholder="外卖" />
        </div>

        <div>
          <label class="label" for="category-parent">父分类</label>
          <select id="category-parent" v-model="form.parentId" class="field">
            <option value="">（顶层分类）</option>
            <option v-for="node in topLevelOptions" :key="node.id" :value="node.id">{{ node.name }}</option>
          </select>
          <p class="mt-1 text-xs text-ink-3">最多两级；调整父分类会把该分类移动到新父级下。</p>
        </div>

        <div>
          <label class="label" for="category-color">颜色</label>
          <input id="category-color" v-model="form.color" type="color" class="h-11 w-20 rounded-lg border border-line" />
        </div>

        <p v-if="errorText" class="form-error">{{ errorText }}</p>

        <div class="flex gap-3">
          <button type="button" class="btn btn-ghost flex-1" @click="formOpen = false">取消</button>
          <button type="submit" class="btn btn-primary flex-1" :disabled="busy">
            {{ busy ? '保存中…' : '保存' }}
          </button>
        </div>
      </form>
    </AppModal>
  </section>
</template>
