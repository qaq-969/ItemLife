<script setup lang="ts">
import PagePlaceholder from '@/components/PagePlaceholder.vue';
</script>

<template>
  <PagePlaceholder
    title="家庭"
    milestone="M4 交付"
    summary="创建家庭、生成邀请码（72 小时有效 / 最多 5 次）、成员角色管理，个人与家庭数据域隔离。"
    :points="[
      '创建家庭并成为 owner；邀请码哈希存储、过期与用尽即失效',
      '成员列表展示角色（owner / member）与加入时间，可移除成员',
      '数据域隔离：家庭视图只聚合家庭数据，个人流水在家庭视图不可见',
      '同一账号可在个人域与家庭域之间切换会计视角',
    ]"
  />
</template>
