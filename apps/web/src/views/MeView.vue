<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();

const groups = computed(() => [
  {
    title: '账本设置',
    summary: '管理当前数据域中的账户和收支分类',
    entries: [
      { name: 'accounts', title: '账户管理', summary: '余额、利率与结息设置' },
      { name: 'categories', title: '分类管理', summary: '收入和支出分类树' },
    ],
  },
  {
    title: '协作与安全',
    summary: '管理家庭成员与账号安全状态',
    entries: [
      { name: 'family', title: '家庭与邀请', summary: '家庭、成员、角色与邀请码' },
      { name: 'security', title: '账号安全', summary: '两步验证、恢复码与登录设备' },
    ],
  },
  ...(['super_admin', 'admin'].includes(auth.user?.siteRole ?? '')
    ? [{
        title: '站点管理',
        summary: '仅站点管理员可见',
        entries: [{ name: 'site-admin', title: '用户与注册', summary: '注册开关、邀请码和用户权限' }],
      }]
    : []),
]);

async function logout(): Promise<void> {
  await auth.logout();
  await router.push({ name: 'login' });
}
</script>

<template>
  <section class="space-y-4">
    <header class="card p-5 sm:flex sm:items-center sm:justify-between sm:gap-4">
      <div class="min-w-0">
        <p class="text-xs font-semibold text-brand">账户身份</p>
        <h1 class="mt-1 truncate text-xl font-semibold">{{ auth.displayName || '我的' }}</h1>
        <p class="mt-1 truncate text-sm text-ink-3">{{ auth.user?.email }}</p>
      </div>
      <p class="mt-3 inline-flex shrink-0 items-center rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand sm:mt-0">
        两步验证：{{ auth.user?.mfaEnabled ? '已开启' : '未开启' }}
      </p>
    </header>

    <div class="grid gap-4 lg:grid-cols-2">
      <section v-for="group in groups" :key="group.title" class="card overflow-hidden">
        <header class="border-b border-line bg-slate-50 px-5 py-3.5">
          <h2 class="text-sm font-semibold">{{ group.title }}</h2>
          <p class="mt-0.5 text-xs text-ink-3">{{ group.summary }}</p>
        </header>
        <nav class="divide-y divide-line" :aria-label="group.title">
          <RouterLink
            v-for="entry in group.entries"
            :key="entry.name"
            :to="{ name: entry.name }"
            class="group flex min-h-16 items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-[-2px]"
          >
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">{{ entry.title }}</span>
              <span class="mt-0.5 block text-xs text-ink-3">{{ entry.summary }}</span>
            </span>
            <span class="text-xl leading-none text-ink-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true">›</span>
          </RouterLink>
        </nav>
      </section>
    </div>

    <section class="card flex items-center justify-between gap-4 p-4 sm:p-5">
      <div>
        <h2 class="text-sm font-semibold">当前会话</h2>
        <p class="mt-0.5 text-xs text-ink-3">退出当前设备上的 ItemLife</p>
      </div>
      <button type="button" class="btn btn-ghost shrink-0" @click="logout">退出登录</button>
    </section>
  </section>
</template>
