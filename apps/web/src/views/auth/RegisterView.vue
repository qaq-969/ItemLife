<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { checkPasswordStrength } from '@itemlife/shared';
import AuthCard from '@/components/AuthCard.vue';
import { authApi } from '@/api/auth';
import { toApiError } from '@/api/http';

const router = useRouter();

const email = ref('');
const nickname = ref('');
const password = ref('');
const confirmPassword = ref('');
const submitting = ref(false);
const errorMessage = ref('');

const strength = computed(() => checkPasswordStrength(password.value));
const mismatch = computed(() => confirmPassword.value.length > 0 && confirmPassword.value !== password.value);
const canSubmit = computed(
  () => email.value.trim().length > 0 && strength.value.ok && !mismatch.value && !submitting.value,
);

async function onSubmit(): Promise<void> {
  if (!canSubmit.value) return;
  errorMessage.value = '';
  submitting.value = true;
  try {
    await authApi.register({
      email: email.value.trim(),
      password: password.value,
      nickname: nickname.value.trim() || undefined,
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
  <AuthCard title="注册" subtitle="注册后可直接使用；建议登录后在「账号安全」中开启两步验证">
    <form class="space-y-3" novalidate @submit.prevent="onSubmit">
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
        {{ submitting ? '提交中…' : '注册' }}
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
