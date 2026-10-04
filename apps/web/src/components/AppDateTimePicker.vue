<script setup lang="ts">
import { computed, ref } from 'vue';
import AppModal from '@/components/AppModal.vue';
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

function show(): void {
  const value = readValue();
  selectedYear.value = value.getFullYear();
  selectedMonth.value = value.getMonth();
  selectedDay.value = value.getDate();
  viewYear.value = selectedYear.value;
  viewMonth.value = selectedMonth.value;
  hour.value = pad(value.getHours());
  minute.value = pad(value.getMinutes());
  open.value = true;
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
</script>

<template>
  <div>
    <button
      :id="id"
      type="button"
      class="field flex items-center justify-between gap-2 text-left"
      :class="modelValue ? 'text-ink' : 'text-ink-3'"
      :aria-label="ariaLabel"
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

    <AppModal :open="open" :title="mode === 'datetime' ? '选择日期和时间' : '选择日期'" @close="open = false">
      <div class="flex items-center justify-between gap-3">
        <button type="button" class="btn btn-ghost min-h-10 px-3" aria-label="上个月" @click="moveMonth(-1)">‹</button>
        <p class="font-semibold tabular-nums">{{ viewYear }} 年 {{ viewMonth + 1 }} 月</p>
        <button type="button" class="btn btn-ghost min-h-10 px-3" aria-label="下个月" @click="moveMonth(1)">›</button>
      </div>

      <div class="mt-3 grid grid-cols-7 gap-1 text-center">
        <span v-for="weekday in WEEKDAYS" :key="weekday" class="py-1 text-xs font-medium text-ink-3">{{
          weekday
        }}</span>
        <template v-for="(day, index) in calendarDays" :key="index">
          <span v-if="day === null" class="min-h-10" aria-hidden="true"></span>
          <button
            v-else
            type="button"
            class="min-h-10 rounded-lg text-sm tabular-nums hover:bg-brand-soft"
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

      <div v-if="mode === 'datetime'" class="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
        <div><span class="label">小时</span><AppSelect v-model="hour" :options="hourOptions" /></div>
        <div><span class="label">分钟</span><AppSelect v-model="minute" :options="minuteOptions" /></div>
      </div>

      <div class="mt-4 flex gap-2 border-t border-line pt-4">
        <button type="button" class="btn btn-ghost px-4" @click="chooseToday">现在</button>
        <button type="button" class="btn btn-ghost flex-1" @click="open = false">取消</button>
        <button type="button" class="btn btn-primary flex-1" @click="confirm">确定</button>
      </div>
    </AppModal>
  </div>
</template>
