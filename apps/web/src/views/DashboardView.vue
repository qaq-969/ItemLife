<script setup lang="ts">
import PagePlaceholder from '@/components/PagePlaceholder.vue';
</script>

<template>
  <PagePlaceholder
    title="首页看板"
    milestone="M5 交付"
    summary="消费 / 储蓄 / 收益 / 净值趋势与分类占比；手机单列、平板双列、桌面三列卡片，图表随视口自适应。"
    :points="[
      '本月消费 / 储蓄 / 收益 / 净值 四个总览卡片（与流水手工核算一致）',
      '消费趋势折线（日 / 月切换）与分类占比环形图（ECharts 按需引入）',
      '同环比对比与物品投入统计（购买总额、当前持有成本、日均成本）',
      '数据域切换：个人视角与家庭视角分开聚合',
    ]"
  />
</template>
