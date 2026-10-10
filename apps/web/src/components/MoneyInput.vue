<script setup lang="ts">
defineOptions({ inheritAttrs: false });

withDefaults(defineProps<{ modelValue: string; wrapperClass?: string; inputClass?: string }>(), {
  wrapperClass: '',
  inputClass: '',
});

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<template>
  <div class="relative min-w-0" :class="wrapperClass">
    <input
      v-bind="$attrs"
      :value="modelValue"
      class="field w-full pr-9"
      :class="inputClass"
      inputmode="decimal"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <span aria-hidden="true" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-3">元</span>
  </div>
</template>
