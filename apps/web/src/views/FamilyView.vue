<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { HouseholdInviteDto, HouseholdMemberDto } from '@itemlife/shared';
import { familyApi } from '@/api/family';
import { ApiError } from '@/api/http';
import { useDomainStore } from '@/stores/domain';
import AppModal from '@/components/AppModal.vue';

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

const selected = computed(() => domain.households.find((row) => row.id === selectedId.value) ?? null);
const isOwner = computed(() => selected.value?.role === 'owner');

function feedback(text: string): void {
  message.value = text;
  window.setTimeout(() => { if (message.value === text) message.value = null; }, 3_000);
}

async function loadDetail(): Promise<void> {
  const id = selectedId.value;
  if (!id) { members.value = []; invites.value = []; return; }
  members.value = await familyApi.members(id);
  invites.value = isOwner.value ? await familyApi.invites(id) : [];
}

async function reload(preferredId?: string): Promise<void> {
  await domain.load();
  selectedId.value = preferredId && domain.households.some((row) => row.id === preferredId)
    ? preferredId : selectedId.value || domain.households[0]?.id || '';
  await loadDetail();
}

async function run(action: () => Promise<void>): Promise<void> {
  busy.value = true; errorText.value = null;
  try { await action(); }
  catch (error) { errorText.value = error instanceof ApiError ? error.message : '操作失败，请重试'; }
  finally { busy.value = false; }
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

    <div v-if="domain.households.length" class="grid gap-4 lg:grid-cols-[240px_1fr]">
      <nav class="card self-start p-2">
        <button v-for="row in domain.households" :key="row.id" type="button" class="flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-sm" :class="selectedId === row.id ? 'bg-brand-soft text-brand' : 'hover:bg-slate-50'" @click="selectedId = row.id; loadDetail()">
          <span class="truncate font-medium">{{ row.name }}</span><span class="ml-2 shrink-0 text-xs">{{ row.memberCount }} 人</span>
        </button>
      </nav>

      <div v-if="selected" class="space-y-4">
        <section class="card p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div><h2 class="font-semibold">{{ selected.name }}</h2><p class="text-xs text-ink-3">{{ isOwner ? '家庭创建者' : '家庭成员' }}</p></div>
            <div class="flex gap-2">
              <button type="button" class="btn btn-primary min-h-9 px-3 text-xs" @click="domain.setActive(`household:${selected.id}`)">切换到此账本</button>
              <button v-if="!isOwner" type="button" class="btn btn-ghost min-h-9 px-3 text-xs text-danger" @click="leave">退出</button>
            </div>
          </div>
        </section>

        <section v-if="isOwner" class="card p-4">
          <div class="flex items-center justify-between gap-3"><div><h2 class="text-sm font-semibold">邀请成员</h2><p class="text-xs text-ink-3">默认 72 小时有效，最多使用 5 次。</p></div><button type="button" class="btn btn-ghost min-h-9 px-3 text-xs" @click="createInvite">生成邀请码</button></div>
          <div v-if="latestCode" class="mt-3 rounded-lg bg-brand-soft p-3 text-center"><p class="text-xs text-ink-3">本次生成的邀请码</p><p class="mt-1 select-all text-xl font-bold tracking-[0.25em] text-brand">{{ latestCode }}</p><div class="mt-2 flex items-center justify-center gap-3"><p class="text-xs text-ink-3">明文只显示这一次</p><button type="button" class="text-xs font-semibold text-brand" @click="copyInvite">复制</button></div></div>
          <ul v-if="invites.length" class="mt-3 space-y-2">
            <li v-for="invite in invites" :key="invite.id" class="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-xs">
              <span>{{ invite.revokedAt ? '已失效' : new Date(invite.expiresAt) <= new Date() ? '已过期' : '有效' }} · {{ invite.usedCount }}/{{ invite.maxUses }} 次 · {{ new Date(invite.expiresAt).toLocaleString() }} 到期</span>
              <button v-if="!invite.revokedAt && new Date(invite.expiresAt) > new Date()" type="button" class="text-danger" @click="revoke(invite)">使失效</button>
            </li>
          </ul>
        </section>

        <section class="card p-4">
          <h2 class="text-sm font-semibold">成员</h2>
          <ul class="mt-3 divide-y divide-line">
            <li v-for="member in members" :key="member.userId" class="flex min-h-12 items-center justify-between gap-3 py-2">
              <div class="min-w-0"><p class="truncate text-sm font-medium">{{ member.nickname || member.email }}</p><p class="truncate text-xs text-ink-3">{{ member.email }} · {{ member.role === 'owner' ? '创建者' : '成员' }}</p></div>
              <button v-if="isOwner && member.role !== 'owner'" type="button" class="btn btn-ghost min-h-9 px-3 text-xs text-danger" @click="removeMember(member)">移除</button>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <div v-else class="card p-5 text-sm text-ink-3">还没有家庭。创建一个家庭，或输入家人分享的邀请码加入。</div>

    <AppModal :open="pendingConfirm !== null" :title="pendingConfirm?.title ?? '确认操作'" @close="pendingConfirm = null">
      <p class="text-sm leading-6 text-ink-2">{{ pendingConfirm?.body }}</p>
      <div class="mt-5 grid grid-cols-2 gap-2">
        <button type="button" class="btn btn-ghost" @click="pendingConfirm = null">取消</button>
        <button type="button" class="btn bg-danger text-white" @click="confirmPending">确认</button>
      </div>
    </AppModal>
  </section>
</template>
