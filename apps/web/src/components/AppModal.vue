<script setup lang="ts">
import { ref } from 'vue';

defineProps<{ open: boolean; title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const pressedBackdrop = ref(false);

function onPointerDown(event: PointerEvent): void {
  pressedBackdrop.value = event.target === event.currentTarget;
}

function onPointerUp(event: PointerEvent): void {
  const releasedOnBackdrop = event.target === event.currentTarget;
  if (pressedBackdrop.value && releasedOnBackdrop) emit('close');
  pressedBackdrop.value = false;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal" appear>
      <div
        v-if="open"
        class="modal-backdrop fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm sm:p-4"
        @pointerdown="onPointerDown"
        @pointerup="onPointerUp"
        @pointercancel="pressedBackdrop = false"
      >
        <div
          class="modal-panel max-h-[88dvh] w-full overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
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
    </Transition>
  </Teleport>
</template>
