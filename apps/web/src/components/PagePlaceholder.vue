<script setup lang="ts">
defineProps<{
  title: string;
  summary: string;
  milestone: string;
  points: string[];
}>();
</script>

<template>
  <section class="space-y-4">
    <header class="card p-5">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="text-xl font-semibold">{{ title }}</h1>
        <span class="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">
          {{ milestone }}
        </span>
      </div>
      <p class="mt-2 text-sm leading-relaxed text-ink-3">{{ summary }}</p>
    </header>

    <div class="card p-5">
      <h2 class="text-sm font-semibold text-ink-2">该模块交付内容</h2>
      <ul class="mt-3 space-y-2 text-sm text-ink-2">
        <li v-for="point in points" :key="point" class="flex gap-2">
          <span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand"></span>
          <span class="leading-relaxed">{{ point }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>
