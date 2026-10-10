<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { checkPasswordStrength, type SiteAdminOverviewDto, type SiteInviteDto, type SiteUserDto } from '@itemlife/shared';
import AppModal from '@/components/AppModal.vue';
import { siteAdminApi } from '@/api/site-admin';
import { toApiError } from '@/api/http';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const data = ref<SiteAdminOverviewDto | null>(null);
const busy = ref(false);
const errorMessage = ref('');
const newInviteCode = ref('');
const inviteRemark = ref('');
const copyNotice = ref('');
const successMessage = ref('');
const pending = ref<null | { title: string; body: string; run: () => Promise<void> }>(null);
const passwordTarget = ref<SiteUserDto | null>(null);
const newPassword = ref('');
const confirmPassword = ref('');
const deleteTarget = ref<SiteUserDto | null>(null);
const deleteConfirmation = ref('');

const isSuper = computed(() => auth.user?.siteRole === 'super_admin');
const passwordStrength = computed(() => checkPasswordStrength(newPassword.value));
const passwordReady = computed(() => passwordStrength.value.ok && newPassword.value === confirmPassword.value);
const deleteReady = computed(() => deleteTarget.value !== null && deleteConfirmation.value.trim() === deleteTarget.value.email);

async function load(): Promise<void> {
  errorMessage.value = '';
  try { data.value = await siteAdminApi.overview(); }
  catch (error) { errorMessage.value = toApiError(error).message; }
}

async function setRegistration(open: boolean): Promise<void> {
  if (!data.value || busy.value) return;
  busy.value = true;
  errorMessage.value = '';
  copyNotice.value = '';
  try {
    const status = await siteAdminApi.updateRegistration(open);
    data.value.registrationOpen = status.registrationOpen;
    newInviteCode.value = '';
  } catch (error) { errorMessage.value = toApiError(error).message; }
  finally { busy.value = false; }
}

async function createInvite(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  errorMessage.value = '';
  copyNotice.value = '';
  try {
    const invite = await siteAdminApi.createInvite(inviteRemark.value);
    newInviteCode.value = invite.code ?? '';
    inviteRemark.value = '';
    await load();
  } catch (error) { errorMessage.value = toApiError(error).message; }
  finally { busy.value = false; }
}

function confirmRevoke(invite: SiteInviteDto): void {
  pending.value = {
    title: '撤销邀请码',
    body: '撤销后该邀请码立即失效，且无法恢复。',
    run: async () => { await siteAdminApi.revokeInvite(invite.id); await load(); },
  };
}

function confirmRole(user: SiteUserDto): void {
  const promote = user.siteRole === 'user';
  pending.value = {
    title: promote ? '设为站点管理员' : '移除管理员权限',
    body: promote
      ? `确认授予 ${user.email} 邀请用户及管理普通用户的权限？`
      : `确认将 ${user.email} 恢复为普通用户？`,
    run: async () => { await siteAdminApi.updateRole(user.id, promote ? 'admin' : 'user'); await load(); },
  };
}

function confirmStatus(user: SiteUserDto): void {
  const enabling = Boolean(user.disabledAt);
  pending.value = {
    title: enabling ? '恢复用户' : '停用用户',
    body: enabling
      ? `恢复后 ${user.email} 可以重新登录，原有数据保持不变。`
      : `将停用 ${user.email} 并立即撤销其全部登录会话；账本数据会保留，可稍后恢复。`,
    run: async () => { await siteAdminApi.updateStatus(user.id, enabling); await load(); },
  };
}

function openPasswordReset(user: SiteUserDto): void {
  passwordTarget.value = user;
  newPassword.value = '';
  confirmPassword.value = '';
  successMessage.value = '';
}

async function resetPassword(): Promise<void> {
  if (!passwordTarget.value || !passwordReady.value || busy.value) return;
  busy.value = true;
  errorMessage.value = '';
  try {
    await siteAdminApi.resetPassword(passwordTarget.value.id, newPassword.value);
    successMessage.value = `已重置 ${passwordTarget.value.email} 的密码，并撤销其全部登录会话。`;
    passwordTarget.value = null;
  } catch (error) { errorMessage.value = toApiError(error).message; }
  finally { busy.value = false; }
}

function openDelete(user: SiteUserDto): void {
  deleteTarget.value = user;
  deleteConfirmation.value = '';
  successMessage.value = '';
}

async function deleteUser(): Promise<void> {
  if (!deleteTarget.value || !deleteReady.value || busy.value) return;
  busy.value = true;
  errorMessage.value = '';
  try {
    await siteAdminApi.deleteUser(deleteTarget.value.id);
    successMessage.value = `已永久删除 ${deleteTarget.value.email}。`;
    deleteTarget.value = null;
    await load();
  } catch (error) { errorMessage.value = toApiError(error).message; }
  finally { busy.value = false; }
}

async function runPending(): Promise<void> {
  const action = pending.value;
  if (!action || busy.value) return;
  busy.value = true;
  errorMessage.value = '';
  try { await action.run(); pending.value = null; }
  catch (error) { errorMessage.value = toApiError(error).message; }
  finally { busy.value = false; }
}

async function copyInvite(): Promise<void> {
  if (!newInviteCode.value) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(newInviteCode.value);
  } else {
    const input = document.createElement('textarea');
    input.value = newInviteCode.value;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  copyNotice.value = '已复制';
}

function inviteState(invite: SiteInviteDto): string {
  if (invite.revokedAt) return '已撤销';
  if (invite.usedAt) return '已使用';
  if (new Date(invite.expiresAt).getTime() <= Date.now()) return '已过期';
  return '可使用';
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

onMounted(() => { void load(); });
</script>

<template>
  <section class="space-y-4">
    <header class="card flex flex-wrap items-center justify-between gap-4 p-5">
      <div>
        <h1 class="text-xl font-semibold">站点管理</h1>
        <p class="mt-1 text-sm text-ink-3">管理注册入口、邀请码和站点级用户权限</p>
      </div>
      <div v-if="data" class="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
        <span class="text-sm font-medium">公开注册</span>
        <button
          v-if="isSuper"
          type="button"
          class="relative h-7 w-12 rounded-full transition-colors"
          :class="data.registrationOpen ? 'bg-brand' : 'bg-slate-300'"
          :aria-pressed="data.registrationOpen"
          :disabled="busy"
          @click="setRegistration(!data.registrationOpen)"
        >
          <span class="absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform" :class="data.registrationOpen ? 'translate-x-5' : 'translate-x-0'" />
        </button>
        <span v-else class="text-sm font-semibold" :class="data.registrationOpen ? 'text-ok' : 'text-ink-3'">
          {{ data.registrationOpen ? '已开启' : '已关闭' }}
        </span>
      </div>
    </header>

    <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
    <p v-if="successMessage" class="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-700">{{ successMessage }}</p>

    <section v-if="data && !data.registrationOpen" class="card p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="font-semibold">注册邀请码</h2>
          <p class="mt-1 text-xs text-ink-3">单次使用，生成后 7 天内有效</p>
        </div>
        <div class="flex w-full gap-2 sm:w-auto">
          <input v-model="inviteRemark" class="field min-w-0 sm:w-64" maxlength="100" placeholder="备注（仅管理员可见）" aria-label="邀请码备注" />
          <button type="button" class="btn btn-primary shrink-0" :disabled="busy" @click="createInvite">生成邀请码</button>
        </div>
      </div>

      <div v-if="newInviteCode" class="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-brand/25 bg-brand-soft p-3">
        <code class="text-lg font-bold tracking-[0.18em] text-brand">{{ newInviteCode }}</code>
        <button type="button" class="btn btn-ghost ml-auto" @click="copyInvite">复制</button>
        <span v-if="copyNotice" class="text-xs font-semibold text-ok">{{ copyNotice }}</span>
        <p class="w-full text-xs text-ink-3">邀请码仅在本次生成后显示，请立即保存。</p>
      </div>

      <div class="mt-4 space-y-2">
        <div v-for="invite in data.invites" :key="invite.id" class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line px-3 py-2.5 text-sm">
          <span class="font-semibold" :class="inviteState(invite) === '可使用' ? 'text-ok' : 'text-ink-3'">{{ inviteState(invite) }}</span>
          <span v-if="invite.remark" class="max-w-full truncate rounded bg-slate-100 px-2 py-1 text-xs text-ink-2" :title="invite.remark">备注：{{ invite.remark }}</span>
          <span class="text-ink-3">创建者 {{ invite.createdByEmail }}</span>
          <span class="text-ink-3">失效 {{ dateTime(invite.expiresAt) }}</span>
          <button v-if="inviteState(invite) === '可使用'" type="button" class="ml-auto text-sm font-semibold text-danger" @click="confirmRevoke(invite)">撤销</button>
        </div>
        <p v-if="data.invites.length === 0" class="text-sm text-ink-3">还没有生成过邀请码。</p>
      </div>
    </section>

    <section v-if="data" class="card overflow-hidden">
      <div class="border-b border-line px-5 py-4">
        <h2 class="font-semibold">用户（{{ data.users.length }}）</h2>
        <p class="mt-1 text-xs text-ink-3">停用可恢复并保留数据；永久删除会清除账号、个人账本及其创建的家庭账本</p>
      </div>
      <div class="divide-y divide-line">
        <article v-for="user in data.users" :key="user.id" class="flex flex-wrap items-center gap-3 px-5 py-4">
          <div class="min-w-0 flex-1 basis-56">
            <p class="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <span class="truncate">{{ user.nickname || user.email }}</span>
              <span v-if="user.inviteRemark" class="max-w-48 shrink truncate rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700" :title="user.inviteRemark">备注：{{ user.inviteRemark }}</span>
            </p>
            <p class="truncate text-xs text-ink-3">{{ user.email }} · {{ dateTime(user.createdAt) }}</p>
          </div>
          <span class="rounded-full px-2.5 py-1 text-xs font-semibold" :class="user.siteRole === 'super_admin' ? 'bg-brand-soft text-brand' : 'bg-slate-100 text-ink-2'">
            {{ user.siteRole === 'super_admin' ? '超级管理员' : user.siteRole === 'admin' ? '管理员' : '普通用户' }}
          </span>
          <span v-if="user.disabledAt" class="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-danger">已停用</span>
          <div v-if="user.id !== auth.user?.id && user.siteRole !== 'super_admin'" class="flex flex-wrap gap-2">
            <button v-if="isSuper" type="button" class="btn btn-ghost" :disabled="busy || Boolean(user.disabledAt)" @click="confirmRole(user)">
              {{ user.siteRole === 'admin' ? '移除管理权限' : '设为管理员' }}
            </button>
            <button v-if="user.siteRole === 'user'" type="button" class="btn btn-ghost" :class="user.disabledAt ? 'text-ok' : 'text-danger'" :disabled="busy" @click="confirmStatus(user)">
              {{ user.disabledAt ? '恢复' : '停用' }}
            </button>
            <button v-if="isSuper" type="button" class="btn btn-ghost" :disabled="busy" @click="openPasswordReset(user)">重置密码</button>
            <button v-if="isSuper" type="button" class="btn btn-ghost text-danger" :disabled="busy" @click="openDelete(user)">永久删除</button>
          </div>
        </article>
      </div>
    </section>

    <p v-if="!data && !errorMessage" class="card p-5 text-sm text-ink-3">正在加载站点信息…</p>

    <AppModal :open="pending !== null" :title="pending?.title ?? '确认操作'" @close="pending = null">
      <p class="text-sm leading-6 text-ink-2">{{ pending?.body }}</p>
      <div class="mt-5 grid grid-cols-2 gap-2">
        <button type="button" class="btn btn-ghost" :disabled="busy" @click="pending = null">取消</button>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="runPending">确认</button>
      </div>
    </AppModal>

    <AppModal :open="passwordTarget !== null" title="重置用户密码" @close="passwordTarget = null">
      <p class="text-sm leading-6 text-ink-2">为 {{ passwordTarget?.email }} 设置新密码。保存后该用户所有设备会立即退出登录。</p>
      <label class="label mt-4 block" for="admin-reset-password">新密码</label>
      <input id="admin-reset-password" v-model="newPassword" class="field mt-1 w-full" type="password" maxlength="128" autocomplete="new-password" />
      <p v-if="newPassword && !passwordStrength.ok" class="mt-1 text-xs text-ink-3">{{ passwordStrength.issues.join('；') }}</p>
      <label class="label mt-3 block" for="admin-reset-password-confirm">确认新密码</label>
      <input id="admin-reset-password-confirm" v-model="confirmPassword" class="field mt-1 w-full" type="password" maxlength="128" autocomplete="new-password" @keyup.enter="resetPassword" />
      <p v-if="confirmPassword && newPassword !== confirmPassword" class="mt-1 text-xs text-danger">两次输入的密码不一致</p>
      <div class="mt-5 grid grid-cols-2 gap-2">
        <button type="button" class="btn btn-ghost" :disabled="busy" @click="passwordTarget = null">取消</button>
        <button type="button" class="btn btn-primary" :disabled="busy || !passwordReady" @click="resetPassword">确认重置</button>
      </div>
    </AppModal>

    <AppModal :open="deleteTarget !== null" title="永久删除用户" @close="deleteTarget = null">
      <p class="text-sm leading-6 text-ink-2">此操作不可恢复。将永久删除账号、个人账本、物品，以及该用户创建的全部家庭账本；其在其他家庭创建的共享记录会保留，但不再显示创建者。</p>
      <label class="label mt-4 block" for="delete-site-user-confirm">输入“{{ deleteTarget?.email }}”确认</label>
      <input id="delete-site-user-confirm" v-model="deleteConfirmation" class="field mt-1 w-full" autocomplete="off" />
      <div class="mt-5 grid grid-cols-2 gap-2">
        <button type="button" class="btn btn-ghost" :disabled="busy" @click="deleteTarget = null">取消</button>
        <button type="button" class="btn bg-danger text-white" :disabled="busy || !deleteReady" @click="deleteUser">永久删除</button>
      </div>
    </AppModal>
  </section>
</template>
