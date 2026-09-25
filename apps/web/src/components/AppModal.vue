<script setup lang="ts">
defineProps<{ open: boolean; title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      @click.self="emit('close')"
    >
      <div
        class="max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl"
        :class="wide ? 'max-w-4xl' : 'max-w-md'"
        role="dialog"
        aria-modal="true"
      >
        <div class="flex items-start justify-between gap-3">
          <h2 class="text-base font-semibold">{{ title }}</h2>
          <button
            type="button"
            class="-mt-1 -mr-1 grid size-9 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-slate-100"
            aria-label="关闭"
            @click="emit('close')"
          >
            <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div class="mt-4">
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>
