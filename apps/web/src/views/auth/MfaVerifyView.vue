<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthCard from '@/components/AuthCard.vue';
import { toApiError } from '@/api/http';
import { useAuthStore } from '@/stores/auth';
import { safeRedirect } from '@/utils/navigation';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const code = ref('');
const submitting = ref(false);
const errorMessage = ref('');

onMounted(() => {
  // 没有登录第一步签发的票据时不允许直接进入本页
  if (!auth.pendingMfaTicket) {
    void router.replace({ name: 'login' });
  }
});

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  errorMessage.value = '';
  submitting.value = true;
  try {
    await auth.verifyMfa(code.value.trim());
    await router.push(safeRedirect(route.query.redirect) ?? { name: 'dashboard' });
  } catch (error) {
    errorMessage.value = toApiError(error).message;
  } finally {
    submitting.value = false;
  }
}

function backToLogin(): void {
  auth.clearSession();
  void router.replace({ name: 'login' });
}
</script>

<template>
  <AuthCard title="两步验证" subtitle="输入身份验证器中的 6 位动态码，或使用一枚恢复码">
    <form class="space-y-3" novalidate @submit.prevent="onSubmit">
      <div>
        <label class="label" for="code">动态码 / 恢复码</label>
        <input
          id="code"
          v-model="code"
          class="field font-mono tracking-widest"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          placeholder="000000"
          required
        />
      </div>

      <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>

      <button class="btn btn-primary w-full" type="submit" :disabled="submitting || code.trim().length === 0">
        {{ submitting ? '验证中…' : '验证并登录' }}
      </button>
    </form>

    <template #footer>
      <button class="w-full text-center text-sm text-ink-3" type="button" @click="backToLogin">
        返回登录
      </button>
    </template>
  </AuthCard>
</template>
