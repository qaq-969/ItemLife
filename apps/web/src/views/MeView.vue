<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import AppModal from '@/components/AppModal.vue';
import { toApiError } from '@/api/http';

const auth = useAuthStore();
const router = useRouter();
const nicknameOpen = ref(false);
const nickname = ref('');
const nicknameError = ref('');
const savingNickname = ref(false);
const saved = ref(false);

const groups = computed(() => [
  {
    title: '账本设置',
    summary: '管理当前数据域中的账户和收支分类',
    entries: [
      { name: 'accounts', title: '账户管理', summary: '余额、利率与结息设置', icon: 'M3 7.5h18v11A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5zM3 7.5h13.5A2.5 2.5 0 0 0 19 5H5.5A2.5 2.5 0 0 0 3 7.5M16.5 13h2' },
      { name: 'categories', title: '分类管理', summary: '收入和支出分类树', icon: 'M4 6h16M4 12h16M4 18h16M8 4v4M14 10v4M10 16v4' },
    ],
  },
  {
    title: '协作与安全',
    summary: '管理家庭成员与账号安全状态',
    entries: [
      { name: 'family', title: '家庭与邀请', summary: '家庭、成员、角色与邀请码', icon: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2.5 20a6.5 6.5 0 0 1 13 0M16.2 11.4A3 3 0 0 0 16 5.4M17.5 20a7 7 0 0 0-1.8-4.7' },
      { name: 'security', title: '账号安全', summary: '两步验证、恢复码与登录设备', icon: 'M12 3.2 19 6v5.3c0 4.4-2.9 7.8-7 9.5-4.1-1.7-7-5.1-7-9.5V6zM9.5 12l1.7 1.7 3.6-4' },
    ],
  },
  ...(['super_admin', 'admin'].includes(auth.user?.siteRole ?? '')
    ? [{
        title: '站点管理',
        summary: '仅站点管理员可见',
        entries: [{ name: 'site-admin', title: '用户与注册', summary: '注册开关、邀请码和用户权限', icon: 'M4 7h6M14 7h6M4 12h10M18 12h2M4 17h4M12 17h8' }],
      }]
    : []),
]);

async function logout(): Promise<void> {
  await auth.logout();
  await router.push({ name: 'login' });
}

function openNickname(): void {
  nickname.value = auth.user?.nickname ?? '';
  nicknameError.value = '';
  saved.value = false;
  nicknameOpen.value = true;
}

async function saveNickname(): Promise<void> {
  const value = nickname.value.trim();
  if (!value) return void (nicknameError.value = '昵称不能为空');
  savingNickname.value = true;
  nicknameError.value = '';
  try {
    await auth.updateProfile(value);
    nicknameOpen.value = false;
    saved.value = true;
    window.setTimeout(() => { saved.value = false; }, 3_000);
  } catch (error) {
    nicknameError.value = toApiError(error).message;
  } finally {
    savingNickname.value = false;
  }
}
</script>

<template>
  <section class="space-y-4">
    <header class="card p-5 sm:flex sm:items-center sm:justify-between sm:gap-4">
      <div class="min-w-0">
        <p class="text-xs font-semibold text-brand">账户身份</p>
        <div class="mt-1 flex items-center gap-2">
          <h1 class="truncate text-xl font-semibold">{{ auth.displayName || '我的' }}</h1>
          <button type="button" class="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-brand hover:bg-brand-soft" @click="openNickname">修改昵称</button>
        </div>
        <p class="mt-1 truncate text-sm text-ink-3">{{ auth.user?.email }}</p>
      </div>
      <p class="mt-3 inline-flex shrink-0 items-center rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand sm:mt-0">
        两步验证：{{ auth.user?.mfaEnabled ? '已开启' : '未开启' }}
      </p>
    </header>

    <p v-if="saved" class="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">昵称已更新</p>

    <div class="grid gap-4 lg:grid-cols-2">
      <section v-for="group in groups" :key="group.title" class="card overflow-hidden">
        <header class="border-b border-line bg-slate-50 px-5 py-3.5">
          <h2 class="text-sm font-semibold">{{ group.title }}</h2>
          <p class="mt-0.5 text-xs text-ink-3">{{ group.summary }}</p>
        </header>
        <nav class="divide-y divide-line" :aria-label="group.title">
          <RouterLink
            v-for="entry in group.entries"
            :key="entry.name"
            :to="{ name: entry.name }"
            class="group flex min-h-16 items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-[-2px]"
          >
            <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
              <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path :d="entry.icon" />
              </svg>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">{{ entry.title }}</span>
              <span class="mt-0.5 block text-xs text-ink-3">{{ entry.summary }}</span>
            </span>
            <span class="text-xl leading-none text-ink-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true">›</span>
          </RouterLink>
        </nav>
      </section>
    </div>

    <section class="card flex items-center justify-between gap-4 p-4 sm:p-5">
      <div>
        <h2 class="text-sm font-semibold">当前会话</h2>
        <p class="mt-0.5 text-xs text-ink-3">退出当前设备上的 ItemLife</p>
      </div>
      <button type="button" class="btn btn-ghost shrink-0" @click="logout">退出登录</button>
    </section>

    <AppModal :open="nicknameOpen" title="修改昵称" @close="nicknameOpen = false">
      <label class="label" for="profile-nickname">昵称</label>
      <input id="profile-nickname" v-model="nickname" class="field" maxlength="50" autocomplete="nickname" placeholder="请输入昵称" @keyup.enter="saveNickname" />
      <p class="mt-2 text-xs text-ink-3">昵称会显示在侧栏、家庭成员和操作记录中。</p>
      <p v-if="nicknameError" class="form-error mt-3">{{ nicknameError }}</p>
      <div class="mt-5 grid grid-cols-2 gap-2">
        <button type="button" class="btn btn-ghost" :disabled="savingNickname" @click="nicknameOpen = false">取消</button>
        <button type="button" class="btn btn-primary" :disabled="savingNickname || !nickname.trim()" @click="saveNickname">{{ savingNickname ? '保存中…' : '保存' }}</button>
      </div>
    </AppModal>
  </section>
</template>
