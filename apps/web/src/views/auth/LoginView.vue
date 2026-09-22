<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import AuthCard from '@/components/AuthCard.vue';
import { toApiError } from '@/api/http';
import { useAuthStore } from '@/stores/auth';
import { safeRedirect } from '@/utils/navigation';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const email = ref('');
const password = ref('');
const submitting = ref(false);
const errorMessage = ref('');

const registered = computed(() => route.query.registered === '1');

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  errorMessage.value = '';
  submitting.value = true;
  try {
    const { mfaRequired } = await auth.login({
      email: email.value.trim(),
      password: password.value,
    });
    const redirect = safeRedirect(route.query.redirect);
    if (mfaRequired) {
      await router.push({ name: 'mfa-verify', query: redirect ? { redirect } : {} });
      return;
    }
    await router.push(redirect ?? { name: 'dashboard' });
  } catch (error) {
    errorMessage.value = toApiError(error).message;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthCard title="登录" subtitle="使用邮箱与密码登录；开启了两步验证的账号需再输入动态码">
    <p v-if="registered" class="mb-3 rounded-lg border border-emerald-200 bg-ok-soft px-3 py-2 text-xs text-ok">
      注册成功，请登录。
    </p>

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
        <label class="label" for="password">密码</label>
        <input
          id="password"
          v-model="password"
          class="field"
          type="password"
          autocomplete="current-password"
          required
        />
      </div>

      <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>

      <button class="btn btn-primary w-full" type="submit" :disabled="submitting">
        {{ submitting ? '登录中…' : '登录' }}
      </button>
    </form>

    <template #footer>
      <p class="text-center text-sm text-ink-3">
        还没有账号？
        <RouterLink class="font-semibold text-brand" :to="{ name: 'register' }">注册</RouterLink>
      </p>
    </template>
  </AuthCard>
</template>
