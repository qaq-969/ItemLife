<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import AppSelect from '@/components/AppSelect.vue';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    mode?: 'date' | 'datetime';
    id?: string;
    ariaLabel?: string;
    placeholder?: string;
  }>(),
  {
    mode: 'date',
    id: undefined,
    ariaLabel: undefined,
    placeholder: '请选择时间',
  },
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});
const viewYear = ref(0);
const viewMonth = ref(0);
const selectedDay = ref(1);
const selectedYear = ref(0);
const selectedMonth = ref(0);
const hour = ref('00');
const minute = ref('00');

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const hourOptions = Array.from({ length: 24 }, (_, value) => ({
  value: pad(value),
  label: `${pad(value)} 时`,
}));
const minuteOptions = Array.from({ length: 60 }, (_, value) => ({
  value: pad(value),
  label: `${pad(value)} 分`,
}));

const displayValue = computed(() => {
  if (!props.modelValue) return props.placeholder;
  return props.mode === 'datetime'
    ? props.modelValue.replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}).*$/, '$1/$2/$3 $4:$5')
    : props.modelValue.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$1/$2/$3');
});

const calendarDays = computed(() => {
  const firstWeekday = (new Date(viewYear.value, viewMonth.value, 1).getDay() + 6) % 7;
  const count = new Date(viewYear.value, viewMonth.value + 1, 0).getDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= count ? day : null;
  });
});

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function readValue(): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(props.modelValue);
  if (!match) return new Date();
  const value = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
  );
  return Number.isNaN(value.getTime()) ? new Date() : value;
}

async function show(): Promise<void> {
  if (open.value) {
    open.value = false;
    return;
  }
  const value = readValue();
  selectedYear.value = value.getFullYear();
  selectedMonth.value = value.getMonth();
  selectedDay.value = value.getDate();
  viewYear.value = selectedYear.value;
  viewMonth.value = selectedMonth.value;
  hour.value = pad(value.getHours());
  minute.value = pad(value.getMinutes());
  open.value = true;
  await nextTick();
  positionPanel();
}

function positionPanel(): void {
  if (!open.value || !root.value || !panel.value) return;
  const trigger = root.value.getBoundingClientRect();
  const margin = 8;
  const gap = 6;
  const width = Math.min(Math.max(trigger.width, 320), window.innerWidth - margin * 2);
  const left = Math.min(Math.max(trigger.left, margin), window.innerWidth - width - margin);
  const panelHeight = panel.value.offsetHeight;
  const spaceBelow = window.innerHeight - trigger.bottom - gap - margin;
  const spaceAbove = trigger.top - gap - margin;
  const openAbove = panelHeight > spaceBelow && spaceAbove > spaceBelow;
  const top = openAbove
    ? Math.max(margin, trigger.top - panelHeight - gap)
    : Math.min(trigger.bottom + gap, window.innerHeight - panelHeight - margin);
  panelStyle.value = { left: `${left}px`, top: `${Math.max(margin, top)}px`, width: `${width}px` };
}

function closeOnOutside(event: PointerEvent): void {
  const target = event.target as Node;
  if (!root.value?.contains(target) && !panel.value?.contains(target)) open.value = false;
}

function closeOnEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false;
}

function moveMonth(delta: number): void {
  const value = new Date(viewYear.value, viewMonth.value + delta, 1);
  viewYear.value = value.getFullYear();
  viewMonth.value = value.getMonth();
}

function chooseDay(day: number): void {
  selectedYear.value = viewYear.value;
  selectedMonth.value = viewMonth.value;
  selectedDay.value = day;
}

function chooseToday(): void {
  const now = new Date();
  selectedYear.value = now.getFullYear();
  selectedMonth.value = now.getMonth();
  selectedDay.value = now.getDate();
  viewYear.value = selectedYear.value;
  viewMonth.value = selectedMonth.value;
  if (props.mode === 'datetime') {
    hour.value = pad(now.getHours());
    minute.value = pad(now.getMinutes());
  }
}

function confirm(): void {
  const date = `${selectedYear.value}-${pad(selectedMonth.value + 1)}-${pad(selectedDay.value)}`;
  emit('update:modelValue', props.mode === 'datetime' ? `${date}T${hour.value}:${minute.value}` : date);
  open.value = false;
}

onMounted(() => {
  document.addEventListener('pointerdown', closeOnOutside);
  document.addEventListener('keydown', closeOnEscape);
  window.addEventListener('resize', positionPanel);
  window.addEventListener('scroll', positionPanel, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeOnOutside);
  document.removeEventListener('keydown', closeOnEscape);
  window.removeEventListener('resize', positionPanel);
  window.removeEventListener('scroll', positionPanel, true);
});
</script>

<template>
  <div ref="root" class="relative min-w-0">
    <button
      :id="id"
      type="button"
      class="field flex items-center justify-between gap-2 text-left"
      :class="modelValue ? 'text-ink' : 'text-ink-3'"
      :aria-label="ariaLabel"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="show"
    >
      <span class="truncate tabular-nums">{{ displayValue }}</span>
      <svg
        viewBox="0 0 24 24"
        class="size-4 shrink-0 text-ink-3"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        aria-hidden="true"
      >
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </svg>
    </button>

    <Teleport to="body">
      <Transition name="date-picker">
        <div
          v-if="open"
          ref="panel"
          class="fixed z-50 max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-xl border border-line bg-white p-3 shadow-xl sm:p-4"
          :style="panelStyle"
          role="dialog"
          :aria-label="mode === 'datetime' ? '选择日期和时间' : '选择日期'"
        >
          <div class="flex items-center justify-between gap-3">
            <button type="button" class="btn btn-ghost min-h-9 px-3" aria-label="上个月" @click="moveMonth(-1)">‹</button>
            <p class="font-semibold tabular-nums">{{ viewYear }} 年 {{ viewMonth + 1 }} 月</p>
            <button type="button" class="btn btn-ghost min-h-9 px-3" aria-label="下个月" @click="moveMonth(1)">›</button>
          </div>

          <div class="mt-2 grid grid-cols-7 gap-1 text-center">
            <span v-for="weekday in WEEKDAYS" :key="weekday" class="py-1 text-xs font-medium text-ink-3">{{
              weekday
            }}</span>
            <template v-for="(day, index) in calendarDays" :key="index">
              <span v-if="day === null" class="min-h-9" aria-hidden="true"></span>
              <button
                v-else
                type="button"
                class="min-h-9 rounded-lg text-sm tabular-nums hover:bg-brand-soft"
                :class="
                  selectedYear === viewYear && selectedMonth === viewMonth && selectedDay === day
                    ? 'bg-brand text-white hover:bg-brand'
                    : 'text-ink'
                "
                @click="chooseDay(day)"
              >
                {{ day }}
              </button>
            </template>
          </div>

          <div v-if="mode === 'datetime'" class="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3">
            <div><span class="label">小时</span><AppSelect v-model="hour" :options="hourOptions" /></div>
            <div><span class="label">分钟</span><AppSelect v-model="minute" :options="minuteOptions" /></div>
          </div>

          <div class="mt-3 flex gap-2 border-t border-line pt-3">
            <button type="button" class="btn btn-ghost px-3" @click="chooseToday">现在</button>
            <button type="button" class="btn btn-ghost flex-1" @click="open = false">取消</button>
            <button type="button" class="btn btn-primary flex-1" @click="confirm">确定</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.date-picker-enter-active,
.date-picker-leave-active {
  transition:
    opacity 120ms ease,
    transform 120ms ease;
  transform-origin: top center;
}

.date-picker-enter-from,
.date-picker-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .date-picker-enter-active,
  .date-picker-leave-active {
    transition: none;
  }
}
</style>
