<script setup lang="ts">
import PagePlaceholder from '@/components/PagePlaceholder.vue';
</script>

<template>
  <PagePlaceholder
    title="记一笔"
    milestone="M2 / M3 交付"
    summary="支出 / 收入 / 转账三态；可关联多个物品并为每个物品指定分摊金额，也可只关联一个物品并继承整笔金额。"
    :points="[
      '顶部三态切换 + 大号金额输入（移动端自定义数字键盘，命中区 ≥ 44px）',
      '归属选择：个人或某个家庭（家庭视图下默认家庭）',
      '分类选择与服务端校验：分摊合计不得超过流水金额',
      '创建接口支持 Idempotency-Key，弱网重试不产生重复记账',
    ]"
  />
</template>
