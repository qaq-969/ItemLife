<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center px-4 py-10">
    <div class="w-full max-w-sm">
      <div class="mb-5 flex items-center gap-2">
        <span class="grid size-9 place-items-center rounded-xl bg-brand text-sm font-bold text-white">IL</span>
        <div>
          <p class="text-base font-semibold leading-tight">ItemLife</p>
          <p class="text-xs text-ink-3">以物品为视角的记账本</p>
        </div>
      </div>

      <div class="card p-5">
        <h1 class="text-lg font-semibold">{{ title }}</h1>
        <p v-if="subtitle" class="mt-1 text-sm text-ink-3">{{ subtitle }}</p>
        <div class="mt-4">
          <slot />
        </div>
      </div>

      <div class="mt-4">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>
