<script setup lang="ts">
import PagePlaceholder from '@/components/PagePlaceholder.vue';
</script>

<template>
  <PagePlaceholder
    title="物品"
    milestone="M3 交付"
    summary="物品档案 + 配件库存 + 成本三指标；列表精简展示，详情页完整展示全部指标与配件消耗记录。"
    :points="[
      '成本三指标：总支付金额、当前持有成本、日均持有成本（设计报告 8.2 公式）',
      '配件库存：如 12 个刷头已用 2 个，展示已用 / 总数与剩余价值',
      '配件使用与撤销均留审计记录，支撑成本回溯',
      '手机列表显示不全时，详情页必须完整展示全部指标与分摊明细',
    ]"
  />
</template>
