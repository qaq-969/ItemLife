<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import type { HouseholdInviteDto, HouseholdMemberDto } from '@itemlife/shared';
import { familyApi } from '@/api/family';
import { ApiError } from '@/api/http';
import { useDomainStore } from '@/stores/domain';
import AppModal from '@/components/AppModal.vue';
import { useCachedPage } from '@/utils/cached-page';

const domain = useDomainStore();
const selectedId = ref('');
const members = ref<HouseholdMemberDto[]>([]);
const invites = ref<HouseholdInviteDto[]>([]);
const createName = ref('');
const joinCode = ref('');
const latestCode = ref('');
const busy = ref(false);
const errorText = ref<string | null>(null);
const message = ref<string | null>(null);
const pendingConfirm = ref<{ title: string; body: string; run: () => Promise<void> } | null>(null);
const renameOpen = ref(false);
const renameName = ref('');
const deleteOpen = ref(false);
const deleteName = ref('');

const selected = computed(() => domain.households.find((row) => row.id === selectedId.value) ?? null);
const isOwner = computed(() => selected.value?.role === 'owner');
const isManager = computed(() => selected.value?.role === 'owner' || selected.value?.role === 'admin');
const deleteReady = computed(() => deleteName.value === selected.value?.name);

function roleLabel(role: HouseholdMemberDto['role']): string {
  return role === 'owner' ? '创建者' : role === 'admin' ? '管理员' : '成员';
}

function feedback(text: string): void {
  message.value = text;
  window.setTimeout(() => { if (message.value === text) message.value = null; }, 3_000);
}

async function loadDetail(): Promise<void> {
  const id = selectedId.value;
  const household = selected.value;
  if (!id || !household) { members.value = []; invites.value = []; return; }
  const [memberRows, inviteRows] = await Promise.all([
    familyApi.members(id),
    household.role === 'owner' || household.role === 'admin' ? familyApi.invites(id) : Promise.resolve([]),
  ]);
  if (selectedId.value !== id) return;
  members.value = memberRows;
  invites.value = inviteRows;
}

async function reload(preferredId?: string): Promise<void> {
  await domain.load();
  selectedId.value = preferredId && domain.households.some((row) => row.id === preferredId)
    ? preferredId : domain.households.some((row) => row.id === selectedId.value)
      ? selectedId.value : domain.households[0]?.id || '';
  await loadDetail();
}

async function run(action: () => Promise<void>): Promise<void> {
  busy.value = true; errorText.value = null;
  try { await action(); }
  catch (error) { errorText.value = error instanceof ApiError ? error.message : '操作失败，请重试'; }
  finally { busy.value = false; }
}

function selectHousehold(id: string, event?: MouseEvent): void {
  if (id === selectedId.value) return;
  const tab = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  selectedId.value = id;
  members.value = [];
  invites.value = [];
  latestCode.value = '';
  if (tab && window.matchMedia('(max-width: 1023px)').matches) {
    void nextTick(() => tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }));
  }
  void run(loadDetail);
}

function createHousehold(): void {
  const name = createName.value.trim();
  if (!name) return void (errorText.value = '请填写家庭名称');
  void run(async () => {
    const row = await familyApi.create(name); createName.value = ''; await reload(row.id); feedback('家庭已创建');
  });
}

function join(): void {
  const code = joinCode.value.trim().toUpperCase();
  if (code.length !== 8) return void (errorText.value = '请输入 8 位邀请码');
  void run(async () => { const row = await familyApi.join(code); joinCode.value = ''; await reload(row.id); feedback('已加入家庭'); });
}

function openRename(): void {
  renameName.value = selected.value?.name ?? '';
  renameOpen.value = true;
}

function saveName(): void {
  const id = selectedId.value;
  const name = renameName.value.trim();
  if (!name) return void (errorText.value = '请填写家庭名称');
  void run(async () => { await familyApi.update(id, name); renameOpen.value = false; await reload(id); feedback('家庭名称已修改'); });
}

function openDelete(): void {
  deleteName.value = '';
  deleteOpen.value = true;
}

function deleteHousehold(): void {
  const id = selectedId.value;
  if (!deleteReady.value) return;
  void run(async () => {
    await familyApi.remove(id, deleteName.value);
    deleteOpen.value = false;
    domain.setActive('user');
    selectedId.value = '';
    await reload();
    feedback('家庭及其全部数据已删除');
  });
}

function createInvite(): void {
  if (!selectedId.value) return;
  void run(async () => {
    const invite = await familyApi.createInvite(selectedId.value); latestCode.value = invite.code ?? '';
    await loadDetail(); feedback('邀请码已生成，请及时复制');
  });
}

function revoke(invite: HouseholdInviteDto): void {
  pendingConfirm.value = {
    title: '使邀请码失效', body: '失效后尚未加入的成员将不能再使用这个邀请码。',
    run: async () => { await familyApi.revokeInvite(selectedId.value, invite.id); await loadDetail(); feedback('邀请码已失效'); },
  };
}

function changeRole(member: HouseholdMemberDto): void {
  const nextRole = member.role === 'admin' ? 'member' : 'admin';
  pendingConfirm.value = {
    title: nextRole === 'admin' ? '设为家庭管理员' : '移除管理员权限',
    body: nextRole === 'admin'
      ? `「${member.nickname || member.email}」将可以管理邀请并移除普通成员。`
      : `「${member.nickname || member.email}」将恢复为普通成员。`,
    run: async () => { await familyApi.updateMemberRole(selectedId.value, member.userId, nextRole); await loadDetail(); feedback('成员权限已更新'); },
  };
}

function canRemove(member: HouseholdMemberDto): boolean {
  return member.role !== 'owner' && (isOwner.value || (isManager.value && member.role === 'member'));
}

function removeMember(member: HouseholdMemberDto): void {
  pendingConfirm.value = {
    title: '移除家庭成员', body: `「${member.nickname || member.email}」将立即失去家庭账本访问权，家庭历史记录会保留。`,
    run: async () => { await familyApi.removeMember(selectedId.value, member.userId); await reload(selectedId.value); feedback('成员已移除'); },
  };
}

function leave(): void {
  pendingConfirm.value = {
    title: '退出家庭', body: `退出「${selected.value?.name ?? ''}」后将立即失去家庭账本访问权，家庭历史记录会保留。`,
    run: async () => { await familyApi.leave(selectedId.value); domain.setActive('user'); selectedId.value = ''; await reload(); feedback('已退出家庭'); },
  };
}

function confirmPending(): void {
  const action = pendingConfirm.value;
  if (!action) return;
  pendingConfirm.value = null;
  void run(action.run);
}

function copyInvite(): void {
  if (!latestCode.value) return;
  void navigator.clipboard.writeText(latestCode.value).then(() => feedback('邀请码已复制')).catch(() => {
    errorText.value = '复制失败，请长按邀请码手动复制';
  });
}

onMounted(() => { void run(() => reload(domain.activeHousehold?.id)); });
useCachedPage({
  refresh: () => run(() => reload(selectedId.value)),
  deactivate: () => {
    pendingConfirm.value = null;
    renameOpen.value = false;
    deleteOpen.value = false;
  },
});
</script>

<template>
  <section class="space-y-4">
    <header class="card p-4 sm:p-5">
      <h1 class="text-lg font-semibold">家庭协作</h1>
      <p class="mt-1 text-sm text-ink-3">家庭账本与个人账本完全隔离；家庭成员可共同管理流水和物品。</p>
      <div class="mt-4 grid grid-cols-2 gap-2">
        <input v-model="createName" class="field" maxlength="50" placeholder="家庭名称" @keyup.enter="createHousehold" />
        <button type="button" class="btn btn-primary" :disabled="busy" @click="createHousehold">创建家庭</button>
        <input v-model="joinCode" class="field uppercase" maxlength="8" placeholder="8 位邀请码" @keyup.enter="join" />
        <button type="button" class="btn btn-ghost" :disabled="busy" @click="join">加入家庭</button>
      </div>
    </header>

    <p v-if="message" class="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{{ message }}</p>
    <p v-if="errorText" class="form-error">{{ errorText }}</p>

    <div v-if="domain.households.length" class="card overflow-hidden p-0">
      <nav class="border-b border-line bg-slate-100 px-2 pt-2 lg:hidden" aria-label="选择家庭">
        <div class="family-tabs flex items-end gap-1 overflow-x-auto" role="tablist">
          <button v-for="row in domain.households" :key="row.id" type="button" role="tab" :aria-selected="selectedId === row.id" class="min-h-10 flex-none rounded-t-xl border px-3 text-left text-sm transition-[width,background-color,color] duration-200" :class="selectedId === row.id ? '-mb-px border-line border-b-white bg-white font-semibold text-brand' : 'w-28 border-transparent bg-slate-200/70 text-ink-3 hover:bg-slate-200'" @click="selectHousehold(row.id, $event)">
            <span class="block" :class="selectedId === row.id ? 'whitespace-nowrap' : 'truncate'">{{ row.name }}</span>
          </button>
        </div>
      </nav>

      <div class="lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav class="hidden border-r border-line bg-slate-50 p-3 lg:block" aria-label="选择家庭">
          <p class="px-2 pb-2 text-xs font-semibold text-ink-3">我的家庭</p>
          <button v-for="row in domain.households" :key="row.id" type="button" class="flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-sm" :class="selectedId === row.id ? 'bg-brand-soft text-brand' : 'hover:bg-white'" @click="selectHousehold(row.id)">
            <span class="truncate font-medium">{{ row.name }}</span><span class="ml-2 shrink-0 text-xs">{{ row.memberCount }} 人</span>
          </button>
        </nav>

        <div v-if="selected" class="min-w-0 px-4 py-5 sm:px-6">
          <header class="flex flex-wrap items-start justify-between gap-3 pb-5">
            <div class="min-w-0"><div class="flex items-center gap-2"><h2 class="truncate text-lg font-semibold">{{ selected.name }}</h2><span class="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand">{{ roleLabel(selected.role) }}</span></div><p class="mt-1 text-xs text-ink-3">{{ selected.memberCount }} 位成员 · 创建于 {{ new Date(selected.createdAt).toLocaleDateString() }}</p></div>
            <div class="flex flex-wrap justify-end gap-2"><button type="button" class="btn btn-primary min-h-9 px-3 text-xs" @click="domain.setActive(`household:${selected.id}`)">切换到账本</button><button v-if="isOwner" type="button" class="btn btn-ghost min-h-9 px-3 text-xs" @click="openRename">修改名称</button><button v-if="!isOwner" type="button" class="btn btn-ghost min-h-9 px-3 text-xs text-danger" @click="leave">退出家庭</button></div>
          </header>

          <section v-if="isManager" class="border-t border-line py-5">
            <div class="flex flex-wrap items-center justify-between gap-3"><div><h3 class="text-sm font-semibold">邀请成员</h3><p class="mt-0.5 text-xs text-ink-3">默认 72 小时有效，最多使用 5 次。</p></div><button type="button" class="btn btn-ghost min-h-9 px-3 text-xs" @click="createInvite">生成邀请码</button></div>
            <div v-if="latestCode" class="mt-3 rounded-lg bg-brand-soft p-3 text-center"><p class="text-xs text-ink-3">本次生成的邀请码</p><p class="mt-1 select-all text-xl font-bold tracking-[0.25em] text-brand">{{ latestCode }}</p><div class="mt-2 flex items-center justify-center gap-3"><p class="text-xs text-ink-3">明文只显示这一次</p><button type="button" class="text-xs font-semibold text-brand" @click="copyInvite">复制</button></div></div>
            <ul v-if="invites.length" class="mt-3 space-y-2"><li v-for="invite in invites" :key="invite.id" class="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs"><span>{{ invite.revokedAt ? '已失效' : new Date(invite.expiresAt) <= new Date() ? '已过期' : '有效' }} · {{ invite.usedCount }}/{{ invite.maxUses }} 次 · {{ new Date(invite.expiresAt).toLocaleString() }} 到期</span><button v-if="!invite.revokedAt && new Date(invite.expiresAt) > new Date()" type="button" class="shrink-0 text-danger" @click="revoke(invite)">使失效</button></li></ul>
          </section>

          <section class="border-t border-line py-5">
            <div class="flex items-center justify-between"><div><h3 class="text-sm font-semibold">家庭成员</h3><p class="mt-0.5 text-xs text-ink-3">管理员可管理邀请并移除普通成员。</p></div><span class="text-xs text-ink-3">{{ members.length }} 人</span></div>
            <ul class="mt-3 divide-y divide-line"><li v-for="member in members" :key="member.userId" class="flex min-h-14 items-center justify-between gap-3 py-2"><div class="min-w-0"><p class="truncate text-sm font-medium">{{ member.nickname || member.email }}</p><p class="truncate text-xs text-ink-3">{{ member.email }} · {{ roleLabel(member.role) }}</p></div><div v-if="member.role !== 'owner'" class="flex shrink-0 gap-1.5"><button v-if="isOwner" type="button" class="btn btn-ghost min-h-9 px-2.5 text-xs" @click="changeRole(member)">{{ member.role === 'admin' ? '移除管理' : '设为管理' }}</button><button v-if="canRemove(member)" type="button" class="btn btn-ghost min-h-9 px-2.5 text-xs text-danger" @click="removeMember(member)">移除</button></div></li></ul>
          </section>

          <section v-if="isOwner" class="border-t border-line pt-5"><div class="flex flex-wrap items-center justify-between gap-3"><div><h3 class="text-sm font-semibold text-danger">删除家庭</h3><p class="mt-0.5 text-xs text-ink-3">永久删除家庭账本及其全部流水、物品和成员数据。</p></div><button type="button" class="btn btn-ghost min-h-9 px-3 text-xs text-danger" @click="openDelete">删除家庭</button></div></section>
        </div>
      </div>
    </div>

    <div v-else class="card p-5 text-sm text-ink-3">还没有家庭。创建一个家庭，或输入家人分享的邀请码加入。</div>

    <AppModal :open="renameOpen" title="修改家庭名称" @close="renameOpen = false"><label class="label" for="household-name">家庭名称</label><input id="household-name" v-model="renameName" class="field mt-1 w-full" maxlength="50" @keyup.enter="saveName" /><div class="mt-5 grid grid-cols-2 gap-2"><button type="button" class="btn btn-ghost" @click="renameOpen = false">取消</button><button type="button" class="btn btn-primary" :disabled="busy || !renameName.trim()" @click="saveName">保存</button></div></AppModal>

    <AppModal :open="deleteOpen" title="永久删除家庭" @close="deleteOpen = false"><p class="text-sm leading-6 text-ink-2">此操作不可恢复，将永久删除家庭账本中的账户、分类、流水、物品、配件、邀请和成员关系。</p><label class="label mt-4 block" for="delete-household-name">输入“{{ selected?.name }}”确认</label><input id="delete-household-name" v-model="deleteName" class="field mt-1 w-full" autocomplete="off" /><div class="mt-5 grid grid-cols-2 gap-2"><button type="button" class="btn btn-ghost" @click="deleteOpen = false">取消</button><button type="button" class="btn bg-danger text-white" :disabled="busy || !deleteReady" @click="deleteHousehold">永久删除</button></div></AppModal>

    <AppModal :open="pendingConfirm !== null" :title="pendingConfirm?.title ?? '确认操作'" @close="pendingConfirm = null"><p class="text-sm leading-6 text-ink-2">{{ pendingConfirm?.body }}</p><div class="mt-5 grid grid-cols-2 gap-2"><button type="button" class="btn btn-ghost" @click="pendingConfirm = null">取消</button><button type="button" class="btn bg-danger text-white" @click="confirmPending">确认</button></div></AppModal>
  </section>
</template>

<style scoped>
.family-tabs { scrollbar-width: none; }
.family-tabs::-webkit-scrollbar { display: none; }
</style>
