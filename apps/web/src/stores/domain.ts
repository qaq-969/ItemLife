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
  const loaded = ref(false);
  let inFlight: Promise<void> | null = null;
  let requestGeneration = 0;

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
    const generation = ++requestGeneration;
    loading.value = true;
    try {
      const rows = await familyApi.list();
      if (requestGeneration === generation) {
        households.value = rows;
        if (active.value !== 'user' && !activeHousehold.value) setActive('user');
        loaded.value = true;
      }
    } finally {
      if (requestGeneration === generation) loading.value = false;
    }
  }

  function ensureLoaded(): Promise<void> {
    if (loaded.value) return Promise.resolve();
    if (!inFlight) {
      const promise = load().finally(() => { if (inFlight === promise) inFlight = null; });
      inFlight = promise;
    }
    return inFlight;
  }

  function setActive(value: string): void {
    active.value = value === 'user' || value.startsWith('household:') ? value : 'user';
    localStorage.setItem(STORAGE_KEY, active.value);
  }

  function reset(): void {
    households.value = [];
    loaded.value = false;
    inFlight = null;
    requestGeneration += 1;
    setActive('user');
  }

  return { active, households, activeHousehold, query, owner, options, label, loading, loaded, load, ensureLoaded, setActive, reset };
});
