<script setup lang="ts">
import PagePlaceholder from '@/components/PagePlaceholder.vue';
</script>

<template>
  <PagePlaceholder
    title="流水"
    milestone="M2 交付"
    summary="收 / 支 / 转账流水列表；手机为卡片列表，≥1024px 自动升级为表格式列表，同一组件双形态渲染。"
    :points="[
      '游标分页列表 + 按时间 / 分类 / 账户 / 物品筛选',
      '手机端卡片：金额右对齐、分类色点；桌面端表格：多列对齐',
      '关联物品的流水展示「分摊 ¥30 + ¥20」摘要，点进详情完整展示每个物品的分摊与三指标',
      '删除流水后账户余额自动回滚（服务端事务保证）',
    ]"
  />
</template>
