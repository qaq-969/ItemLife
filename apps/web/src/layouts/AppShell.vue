<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useDomainStore } from '@/stores/domain';
import { useLedgerStore } from '@/stores/ledger';
import AppSelect from '@/components/AppSelect.vue';

/** 线性图标（stroke）路径表，避免引入图标库 */
const ICON_PATHS = {
  home: 'M3 10.6 12 3.5l9 7.1M5.5 9.3V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.3',
  list: 'M4 6h16M4 12h16M4 18h10',
  plus: 'M12 5v14M5 12h14',
  box: 'M20.5 8.2 12 3.3 3.5 8.2v7.6l8.5 4.9 8.5-4.9zM3.5 8.2 12 13.1l8.5-4.9M12 13.1v7.6',
  user: 'M12 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5M4.5 20.5a7.5 7.5 0 0 1 15 0',
  users:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2.5 20a6.5 6.5 0 0 1 13 0M16.2 11.4A3 3 0 0 0 16 5.4M17.5 20a7 7 0 0 0-1.8-4.7',
  settings: 'M4 7h6M14 7h6M4 12h10M18 12h2M4 17h4M12 17h8',
} as const;

interface NavItem {
  name: string;
  label: string;
  icon: keyof typeof ICON_PATHS;
}

/** 手机底部 5 Tab（设计报告 9.1） */
const bottomNav: NavItem[] = [
  { name: 'dashboard', label: '首页', icon: 'home' },
  { name: 'transactions', label: '流水', icon: 'list' },
  { name: 'transaction-new', label: '记一笔', icon: 'plus' },
  { name: 'items', label: '物品', icon: 'box' },
  { name: 'me', label: '我的', icon: 'user' },
];

/** ≥1024px 左固定侧边栏 */
const sidebarNav: NavItem[] = [
  { name: 'dashboard', label: '首页', icon: 'home' },
  { name: 'transactions', label: '流水', icon: 'list' },
  { name: 'transaction-new', label: '记一笔', icon: 'plus' },
  { name: 'items', label: '物品', icon: 'box' },
  { name: 'family', label: '家庭', icon: 'users' },
  { name: 'settings', label: '设置', icon: 'settings' },
  { name: 'me', label: '我的', icon: 'user' },
];

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const domain = useDomainStore();
const ledger = useLedgerStore();

const pageTitle = computed(() => (typeof route.meta.title === 'string' ? route.meta.title : 'ItemLife'));

function isActive(name: string): boolean {
  return route.name === name;
}

async function handleLogout(): Promise<void> {
  await auth.logout();
  await router.push({ name: 'login' });
}

watch(() => domain.active, () => ledger.reset());
onMounted(() => { void domain.load().catch(() => undefined); });
</script>

<template>
  <div class="min-h-dvh">
    <!-- 桌面：左侧固定侧边栏 -->
    <aside class="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-line bg-white lg:flex">
      <div class="flex h-16 items-center gap-2 px-5">
        <span class="grid size-8 place-items-center rounded-lg bg-brand text-xs font-bold text-white">IL</span>
        <span class="text-base font-semibold">ItemLife</span>
      </div>

      <nav class="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        <RouterLink
          v-for="item in sidebarNav"
          :key="item.name"
          :to="{ name: item.name }"
          class="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors"
          :class="isActive(item.name) ? 'bg-brand-soft text-brand' : 'text-ink-2 hover:bg-slate-100'"
        >
          <svg
            class="size-5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path :d="ICON_PATHS[item.icon]" />
          </svg>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="border-t border-line p-3">
        <p class="truncate px-2 text-sm font-medium">{{ auth.displayName || '未登录' }}</p>
        <p class="truncate px-2 text-xs text-ink-3">{{ auth.user?.email }}</p>
        <button
          type="button"
          class="mt-2 flex min-h-10 w-full items-center justify-center rounded-lg border border-line text-xs font-semibold text-ink-2 hover:bg-slate-100"
          @click="handleLogout"
        >
          退出登录
        </button>
      </div>
    </aside>

    <div class="lg:pl-60">
      <!-- 移动端顶栏 -->
      <header
        class="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-white/95 px-4 backdrop-blur lg:hidden"
      >
        <span class="text-base font-semibold">{{ pageTitle }}</span>
        <span class="max-w-[40%] truncate text-xs text-ink-3">{{ auth.displayName }}</span>
      </header>

      <main
        class="mx-auto w-full max-w-[1200px] px-4 pt-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:px-8 lg:pt-8 lg:pb-12"
      >
        <div class="mb-4 flex items-center justify-between gap-3">
          <p class="text-xs font-semibold text-ink-3">当前数据域</p>
          <AppSelect :model-value="domain.active" :options="domain.options" class="w-44" @update:model-value="domain.setActive" />
        </div>
        <RouterView v-slot="{ Component, route: currentRoute }">
          <Transition name="page" mode="out-in">
            <component :is="Component" :key="`${String(currentRoute.name)}:${domain.active}`" />
          </Transition>
        </RouterView>
      </main>
    </div>

    <!-- 移动端底部 Tab -->
    <nav
      class="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div class="grid grid-cols-5">
        <RouterLink
          v-for="item in bottomNav"
          :key="item.name"
          :to="{ name: item.name }"
          class="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium"
          :class="isActive(item.name) ? 'text-brand' : 'text-ink-3'"
        >
          <span
            v-if="item.name === 'transaction-new'"
            class="grid size-9 place-items-center rounded-full bg-brand text-white shadow-lg shadow-brand/30"
          >
            <svg
              class="size-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            >
              <path :d="ICON_PATHS[item.icon]" />
            </svg>
          </span>
          <svg
            v-else
            class="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path :d="ICON_PATHS[item.icon]" />
          </svg>
          <span>{{ item.label }}</span>
        </RouterLink>
      </div>
    </nav>
  </div>
</template>
