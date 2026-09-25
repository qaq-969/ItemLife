<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';

interface Option { value: string; label: string; disabled?: boolean }
const props = withDefaults(defineProps<{ modelValue: string; options: Option[]; placeholder?: string }>(), { placeholder: '请选择' });
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const label = computed(() => props.options.find((option) => option.value === props.modelValue)?.label ?? props.placeholder);
function choose(option: Option): void { if (option.disabled) return; emit('update:modelValue', option.value); open.value = false; }
function closeOnOutside(event: MouseEvent): void { if (root.value && !root.value.contains(event.target as Node)) open.value = false; }
document.addEventListener('click', closeOnOutside);
onBeforeUnmount(() => document.removeEventListener('click', closeOnOutside));
</script>

<template>
  <div ref="root" class="relative min-w-0">
    <button type="button" class="field flex h-9 w-full items-center justify-between gap-2 py-1 text-left text-sm" :aria-expanded="open" @click="open = !open">
      <span class="truncate">{{ label }}</span><span class="text-ink-3">⌄</span>
    </button>
    <div v-if="open" class="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-lg">
      <button v-for="option in options" :key="option.value" type="button" class="flex min-h-9 w-full items-center rounded-md px-2 text-left text-sm hover:bg-brand-soft" :class="option.value === modelValue ? 'bg-brand-soft text-brand' : 'text-ink'" :disabled="option.disabled" @click="choose(option)">{{ option.label }}</button>
    </div>
  </div>
</template>
