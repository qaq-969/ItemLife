import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { AccountDto, AccountSummaryDto, CategoryDto } from '@itemlife/shared';
import { accountsApi, categoriesApi } from '@/api/ledger';
import { useDomainStore } from '@/stores/domain';

/**
 * 账本公共数据：账户与分类在多个页面（记一笔 / 流水 / 账户 / 分类管理）反复使用，
 * 集中缓存一次拉取，任何改动后调用 refresh() 保持一致。个人数据域（M2 范围）。
 */
export const useLedgerStore = defineStore('ledger', () => {
  const domain = useDomainStore();
  const accounts = ref<AccountDto[]>([]);
  const categories = ref<CategoryDto[]>([]);
  const summary = ref<AccountSummaryDto | null>(null);
  const loading = ref(false);
  const loaded = ref(false);
  const error = ref<string | null>(null);

  /** 未停用的支出分类（顶层带 children），记账选择器用 */
  const expenseCategories = computed(() => categories.value.filter((item) => item.kind === 'expense'));
  const incomeCategories = computed(() => categories.value.filter((item) => item.kind === 'income'));

  const accountById = computed(() => new Map(accounts.value.map((item) => [item.id, item])));

  function categoryById(id: string | null): CategoryDto | null {
    if (!id) return null;
    for (const group of categories.value) {
      if (group.id === id) return group;
      const child = group.children.find((item) => item.id === id);
      if (child) return child;
    }
    return null;
  }

  async function loadAccounts(): Promise<void> {
    accounts.value = await accountsApi.list({ domain: domain.query });
  }

  async function loadCategories(includeArchived = false): Promise<void> {
    categories.value = await categoriesApi.list({ includeArchived, domain: domain.query });
  }

  async function loadSummary(): Promise<void> {
    summary.value = await accountsApi.summary({ domain: domain.query });
  }

  /** 首次进入或数据变更后调用；并发调用共用同一次请求。 */
  let inFlight: { key: string; promise: Promise<void> } | null = null;
  let loadedKey: string | null = null;
  let requestGeneration = 0;

  async function refresh(): Promise<void> {
    const key = domain.active;
    if (inFlight?.key === key) return inFlight.promise;
    const generation = ++requestGeneration;
    const promise = (async () => {
      loading.value = true;
      error.value = null;
      try {
        const [accountRows, categoryRows, accountSummary] = await Promise.all([
          accountsApi.list({ domain: domain.query }),
          categoriesApi.list({ domain: domain.query }),
          accountsApi.summary({ domain: domain.query }),
        ]);
        if (requestGeneration === generation && domain.active === key) {
          accounts.value = accountRows;
          categories.value = categoryRows;
          summary.value = accountSummary;
          loaded.value = true;
          loadedKey = key;
        }
      } catch (cause) {
        if (requestGeneration === generation) error.value = cause instanceof Error ? cause.message : '数据加载失败';
        throw cause;
      } finally {
        if (requestGeneration === generation) {
          loading.value = false;
          inFlight = null;
        }
      }
    })();
    inFlight = { key, promise };
    return promise;
  }

  function ensureLoaded(): Promise<void> {
    return loaded.value && loadedKey === domain.active ? Promise.resolve() : refresh();
  }

  function reset(): void {
    accounts.value = [];
    categories.value = [];
    summary.value = null;
    loaded.value = false;
    loadedKey = null;
    error.value = null;
    requestGeneration += 1;
    inFlight = null;
  }

  return {
    accounts,
    categories,
    summary,
    loading,
    loaded,
    error,
    expenseCategories,
    incomeCategories,
    accountById,
    categoryById,
    loadAccounts,
    loadCategories,
    loadSummary,
    refresh,
    ensureLoaded,
    reset,
  };
});
