<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
</script>

<template>
  <section class="space-y-4">
    <header class="card p-5">
      <h1 class="text-xl font-semibold">{{ auth.displayName || '我的' }}</h1>
      <p class="mt-1 text-sm text-ink-3">{{ auth.user?.email }}</p>
      <p class="mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand">
        两步验证：{{ auth.user?.mfaEnabled ? '已开启' : '未开启' }}
      </p>
    </header>

    <nav class="card divide-y divide-line">
      <RouterLink
        v-if="auth.user?.siteRole === 'super_admin' || auth.user?.siteRole === 'admin'"
        class="flex min-h-12 items-center justify-between px-5 text-sm font-medium hover:bg-slate-50"
        :to="{ name: 'site-admin' }"
      >
        <span>站点管理</span>
        <span class="text-ink-3">›</span>
      </RouterLink>
      <RouterLink
        class="flex min-h-12 items-center justify-between px-5 text-sm font-medium hover:bg-slate-50"
        :to="{ name: 'security' }"
      >
        <span>账号安全</span>
        <span class="text-ink-3">›</span>
      </RouterLink>
      <RouterLink
        class="flex min-h-12 items-center justify-between px-5 text-sm font-medium hover:bg-slate-50"
        :to="{ name: 'family' }"
      >
        <span>家庭与邀请</span>
        <span class="text-ink-3">›</span>
      </RouterLink>
      <RouterLink
        class="flex min-h-12 items-center justify-between px-5 text-sm font-medium hover:bg-slate-50"
        :to="{ name: 'settings' }"
      >
        <span>账户与分类设置</span>
        <span class="text-ink-3">›</span>
      </RouterLink>
    </nav>
  </section>
</template>
