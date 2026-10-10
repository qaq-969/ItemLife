<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { checkPasswordStrength } from '@itemlife/shared';
import AuthCard from '@/components/AuthCard.vue';
import { authApi } from '@/api/auth';
import { toApiError } from '@/api/http';
import { siteAdminApi } from '@/api/site-admin';

const router = useRouter();

const email = ref('');
const nickname = ref('');
const password = ref('');
const confirmPassword = ref('');
const inviteCode = ref('');
const submitting = ref(false);
const loadingStatus = ref(true);
const registrationOpen = ref(true);
const initialized = ref(false);
const errorMessage = ref('');

const strength = computed(() => checkPasswordStrength(password.value));
const mismatch = computed(() => confirmPassword.value.length > 0 && confirmPassword.value !== password.value);
const inviteRequired = computed(() => initialized.value && !registrationOpen.value);
const canSubmit = computed(
  () => !loadingStatus.value && email.value.trim().length > 0 && strength.value.ok && !mismatch.value
    && (!inviteRequired.value || inviteCode.value.trim().length === 8) && !submitting.value,
);

onMounted(async () => {
  try {
    const status = await siteAdminApi.status();
    registrationOpen.value = status.registrationOpen;
    initialized.value = status.initialized;
  } catch (error) {
    errorMessage.value = toApiError(error).message;
  } finally {
    loadingStatus.value = false;
  }
});

async function onSubmit(): Promise<void> {
  if (!canSubmit.value) return;
  errorMessage.value = '';
  submitting.value = true;
  try {
    await authApi.register({
      email: email.value.trim(),
      password: password.value,
      nickname: nickname.value.trim() || undefined,
      inviteCode: inviteRequired.value ? inviteCode.value.trim().toUpperCase() : undefined,
    });
    await router.push({ name: 'login', query: { registered: '1' } });
  } catch (error) {
    errorMessage.value = toApiError(error).message;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthCard title="注册" :subtitle="inviteRequired ? '站点仅接受邀请码注册' : '注册后可直接使用；建议登录后开启两步验证'">
    <form class="space-y-3" novalidate @submit.prevent="onSubmit">
      <p v-if="inviteRequired" class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-800">
        私有站点，禁止注册
      </p>

      <div v-if="inviteRequired">
        <label class="label" for="invite-code">邀请码</label>
        <input
          id="invite-code"
          v-model="inviteCode"
          class="field uppercase"
          type="text"
          maxlength="8"
          autocomplete="one-time-code"
          placeholder="8 位邀请码"
          required
          @input="inviteCode = inviteCode.toUpperCase()"
        />
      </div>
      <div>
        <label class="label" for="email">邮箱</label>
        <input
          id="email"
          v-model="email"
          class="field"
          type="email"
          autocomplete="username"
          inputmode="email"
          required
        />
      </div>

      <div>
        <label class="label" for="nickname">昵称（可选）</label>
        <input id="nickname" v-model="nickname" class="field" type="text" autocomplete="nickname" />
      </div>

      <div>
        <label class="label" for="password">密码</label>
        <input
          id="password"
          v-model="password"
          class="field"
          type="password"
          autocomplete="new-password"
          required
        />
        <p v-if="password && !strength.ok" class="mt-1 text-xs text-ink-3">
          还需：{{ strength.issues.join('、') }}
        </p>
      </div>

      <div>
        <label class="label" for="confirm">确认密码</label>
        <input
          id="confirm"
          v-model="confirmPassword"
          class="field"
          type="password"
          autocomplete="new-password"
          required
        />
        <p v-if="mismatch" class="mt-1 text-xs text-danger">两次输入的密码不一致</p>
      </div>

      <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>

      <button class="btn btn-primary w-full" type="submit" :disabled="!canSubmit">
        {{ loadingStatus ? '正在检查站点状态…' : submitting ? '提交中…' : '注册' }}
      </button>
    </form>

    <template #footer>
      <p class="text-center text-sm text-ink-3">
        已有账号？
        <RouterLink class="font-semibold text-brand" :to="{ name: 'login' }">去登录</RouterLink>
      </p>
    </template>
  </AuthCard>
</template>
