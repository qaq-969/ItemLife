<script setup lang="ts">
import PagePlaceholder from '@/components/PagePlaceholder.vue';
</script>

<template>
  <PagePlaceholder
    title="设置"
    milestone="M2 交付"
    summary="账户管理（含利息配置）、分类管理、记账偏好；入口在设置菜单内，移动端全屏可用。"
    :points="[
      '账户：新增 / 编辑 / 停用，配置年化利率与结息频率（月 / 季 / 年）',
      '利息：手动触发结息接口，按日累计、幂等入账（不重复计息）',
      '分类：增删改与排序，区分收入 / 支出，系统分类不可删除',
      '偏好：默认归属、默认账户、货币（v1.0 仅 CNY，字段预留多币种）',
    ]"
  />
</template>
