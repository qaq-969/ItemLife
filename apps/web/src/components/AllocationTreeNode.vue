<script setup lang="ts">
import { computed } from 'vue';
import AppSelect from '@/components/AppSelect.vue';

defineOptions({ name: 'AllocationTreeNode' });

type ItemRole = 'body' | 'accessory' | 'fee' | 'link';
interface AllocationRow { key: string; parentKey: string | null; role: ItemRole; itemId: string; name: string; amountYuan: string; qty: string; lifespanDays: string; }
interface SelectOption { value: string; label: string; disabled?: boolean; }

const props = defineProps<{ row: AllocationRow; allRows: AllocationRow[]; itemOptions: SelectOption[]; childMenuParent: string | null; }>();
const emit = defineEmits<{ fill: [key: string]; toggleChild: [key: string]; addChild: [role: 'accessory' | 'fee']; remove: [key: string]; }>();
const children = computed(() => props.allRows.filter((candidate) => candidate.parentKey === props.row.key));
const roleLabel = computed(() => ({ body: '新建物品', link: '关联物品', accessory: '附加物品', fee: '附加费用' })[props.row.role]);
</script>

<template>
  <div class="relative">
    <article class="rounded-lg border bg-white p-3" :class="row.parentKey === null ? 'border-brand/40 bg-brand-soft/30 border-l-4 border-l-brand' : 'border-line border-l-2 border-l-brand/50'">
      <div class="mb-2"><span class="rounded bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">{{ roleLabel }}</span></div>
      <div class="grid grid-cols-12 items-center gap-2 sm:flex">
        <AppSelect v-if="row.role === 'link'" v-model="row.itemId" :options="itemOptions" class="col-span-8 sm:min-w-0 sm:flex-1" />
        <template v-else>
          <input v-model="row.name" class="field col-span-7 min-w-0 sm:flex-1" :placeholder="row.role === 'body' ? '物品名称' : row.role === 'accessory' ? '附加物品名称' : '附加费用名称'" />
          <input v-model="row.amountYuan" class="field col-span-5 text-right tabular-nums sm:w-28 sm:flex-none" inputmode="decimal" :placeholder="row.role === 'body' ? '本体金额' : '金额'" />
          <input v-if="row.role === 'body'" v-model="row.lifespanDays" class="field col-span-6 min-w-0 text-sm sm:w-44 sm:flex-none" inputmode="numeric" placeholder="预期寿命（天，可选）" />
          <input v-if="row.role === 'accessory'" v-model="row.qty" class="field col-span-3 text-right tabular-nums sm:w-20 sm:flex-none" inputmode="numeric" placeholder="数量" />
          <button type="button" class="btn btn-ghost px-2 text-xs sm:flex-none" :class="row.role === 'body' ? 'col-span-2' : row.role === 'accessory' ? 'col-span-3' : 'col-span-4'" @click="emit('fill', row.key)">补余</button>
        </template>
        <div class="relative sm:flex-none" :class="row.role === 'link' || row.role === 'body' ? 'col-span-2' : row.role === 'accessory' ? 'col-span-3' : 'col-span-4'">
          <button type="button" class="btn btn-ghost w-full px-2 text-xs" @click="emit('toggleChild', row.key)">+ 子项</button>
          <div v-if="childMenuParent === row.key" class="absolute right-0 top-full z-30 mt-1 w-32 rounded-lg border border-line bg-white p-1 shadow-lg"><button type="button" class="w-full rounded px-3 py-2 text-left text-sm hover:bg-brand-soft" @click="emit('addChild', 'accessory')">附加物品</button><button type="button" class="w-full rounded px-3 py-2 text-left text-sm hover:bg-brand-soft" @click="emit('addChild', 'fee')">附加费用</button></div>
        </div>
        <button type="button" class="btn btn-ghost px-2 text-xs text-danger sm:flex-none" :class="row.role === 'link' || row.role === 'body' ? 'col-span-2' : row.role === 'accessory' ? 'col-span-3' : 'col-span-4'" @click="emit('remove', row.key)">移除</button>
      </div>
    </article>

    <div v-if="children.length" class="ml-2 mt-2 sm:ml-4">
      <div v-for="(child, index) in children" :key="child.key" class="relative pb-2 pl-3 last:pb-0 sm:pl-5">
        <span
          aria-hidden="true"
          class="absolute left-0 border-l-2 border-brand/45"
          :class="index === children.length - 1 ? (index === 0 ? '-top-2 h-9' : 'top-0 h-7') : (index === 0 ? '-top-2 bottom-0' : 'top-0 bottom-0')"
        ></span>
        <span aria-hidden="true" class="absolute left-0 top-7 w-3 border-t-2 border-brand/45 sm:w-5"></span>
        <AllocationTreeNode :row="child" :all-rows="allRows" :item-options="itemOptions" :child-menu-parent="childMenuParent" @fill="emit('fill', $event)" @toggle-child="emit('toggleChild', $event)" @add-child="emit('addChild', $event)" @remove="emit('remove', $event)" />
      </div>
    </div>
  </div>
</template>
