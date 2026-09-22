<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
  <div class="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
    <p class="text-3xl font-semibold">404</p>
    <p class="text-sm text-ink-3">页面不存在或已被移动</p>
    <RouterLink class="btn btn-primary" :to="{ name: 'dashboard' }">回到首页</RouterLink>
  </div>
</template>
