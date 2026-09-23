<script setup lang="ts">
import { RouterLink } from 'vue-router';

const entries = [
  {
    name: 'accounts',
    title: '账户管理',
    summary: '余额由流水派生；可配置年化利率与结息周期，随时手动结息',
    icon: 'M3 7.5h18v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5zM3 7.5h13.5A2.5 2.5 0 0 0 19 5H5.5A2.5 2.5 0 0 0 3 7.5M16.5 13h2',
  },
  {
    name: 'categories',
    title: '分类管理',
    summary: '收入 / 支出两套树，最多两级；支持增删改与上下移排序',
    icon: 'M4 6h16M4 12h16M4 18h16M8 4v16',
  },
  {
    name: 'security',
    title: '账号安全',
    summary: '两步验证（TOTP）绑定与恢复码、登录设备与密码管理',
    icon: 'M12 3l7 3v6c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6z',
  },
];
</script>

<template>
  <section class="space-y-4">
    <header class="card p-5">
      <h1 class="text-xl font-semibold">设置</h1>
      <p class="mt-2 text-sm text-ink-3">账户、分类与安全设置；移动端整页可用，桌面端与侧边栏导航并列。</p>
    </header>

    <ul class="space-y-2">
      <li v-for="entry in entries" :key="entry.name">
        <RouterLink :to="{ name: entry.name }" class="card flex items-center gap-4 p-4 hover:border-brand">
          <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path :d="entry.icon" />
            </svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block font-medium">{{ entry.title }}</span>
            <span class="mt-0.5 block text-xs text-ink-3">{{ entry.summary }}</span>
          </span>
          <svg viewBox="0 0 24 24" class="size-5 shrink-0 text-ink-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </RouterLink>
      </li>
    </ul>

    <p class="px-1 text-xs text-ink-3">
      记账偏好（默认账户、默认归属）与多货币在后续里程碑补充；v1.0 仅支持 CNY。
    </p>
  </section>
</template>
