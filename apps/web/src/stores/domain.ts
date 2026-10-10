import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { HouseholdDto } from '@itemlife/shared';
import { familyApi } from '@/api/family';
import type { OwnerBody } from '@/api/ledger';

const STORAGE_KEY = 'itemlife.active-domain';

export const useDomainStore = defineStore('domain', () => {
  const active = ref(typeof localStorage === 'undefined' ? 'user' : (localStorage.getItem(STORAGE_KEY) ?? 'user'));
  const households = ref<HouseholdDto[]>([]);
  const loading = ref(false);

  const activeHousehold = computed(() => {
    const id = active.value.startsWith('household:') ? active.value.slice('household:'.length) : '';
    return households.value.find((row) => row.id === id) ?? null;
  });
  const query = computed(() => active.value === 'user' ? undefined : active.value);
  const owner = computed<OwnerBody>(() => activeHousehold.value
    ? { type: 'household', id: activeHousehold.value.id }
    : { type: 'user' });
  const options = computed(() => [
    { value: 'user', label: '个人账本' },
    ...households.value.map((row) => ({ value: `household:${row.id}`, label: row.name })),
  ]);
  const label = computed(() => activeHousehold.value?.name ?? '个人账本');

  async function load(): Promise<void> {
    loading.value = true;
    try {
      households.value = await familyApi.list();
      if (active.value !== 'user' && !activeHousehold.value) setActive('user');
    } finally {
      loading.value = false;
    }
  }

  function setActive(value: string): void {
    active.value = value === 'user' || value.startsWith('household:') ? value : 'user';
    localStorage.setItem(STORAGE_KEY, active.value);
  }

  function reset(): void {
    households.value = [];
    setActive('user');
  }

  return { active, households, activeHousehold, query, owner, options, label, loading, load, setActive, reset };
});
