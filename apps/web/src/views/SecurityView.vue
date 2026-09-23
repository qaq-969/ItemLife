<script setup lang="ts">
import { ref } from 'vue';
import { authApi, type MfaSetupResult } from '@/api/auth';
import { toApiError } from '@/api/http';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();

const setup = ref<MfaSetupResult | null>(null);
const enableCode = ref('');
const recoveryCodes = ref<string[]>([]);
const disablePassword = ref('');
const disableCode = ref('');
const busy = ref(false);
const errorMessage = ref('');

async function startSetup(): Promise<void> {
  errorMessage.value = '';
  busy.value = true;
  try {
    setup.value = await authApi.mfaSetup();
  } catch (error) {
    errorMessage.value = toApiError(error).message;
  } finally {
    busy.value = false;
  }
}

async function confirmEnable(): Promise<void> {
  errorMessage.value = '';
  busy.value = true;
  try {
    const result = await authApi.mfaEnable(enableCode.value.trim());
    recoveryCodes.value = result.recoveryCodes;
    setup.value = null;
    if (auth.user) auth.user.mfaEnabled = true;
  } catch (error) {
    errorMessage.value = toApiError(error).message;
  } finally {
    busy.value = false;
  }
}

async function disableMfa(): Promise<void> {
  errorMessage.value = '';
  busy.value = true;
  try {
    await authApi.mfaDisable({ password: disablePassword.value, code: disableCode.value.trim() });
    if (auth.user) auth.user.mfaEnabled = false;
    disablePassword.value = '';
    disableCode.value = '';
  } catch (error) {
    errorMessage.value = toApiError(error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="space-y-4">
    <header class="card p-5">
      <h1 class="text-xl font-semibold">账号安全</h1>
      <p class="mt-1 text-sm text-ink-3">
        两步验证（TOTP）用任意身份验证器 App 扫码绑定，服务端仅保存加密后的密钥。
      </p>
    </header>

    <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>

    <!-- 恢复码（仅开启成功时展示一次） -->
    <div v-if="recoveryCodes.length" class="card p-5">
      <h2 class="text-sm font-semibold text-danger">请立即保存恢复码（仅展示这一次）</h2>
      <p class="mt-1 text-xs text-ink-3">每枚恢复码只能使用一次，丢失手机且无恢复码将无法登录。</p>
      <div class="mt-3 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-5">
        <span v-for="code in recoveryCodes" :key="code" class="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
          {{ code }}
        </span>
      </div>
    </div>

    <!-- 已开启 -->
    <div v-else-if="auth.user?.mfaEnabled" class="card p-5">
      <h2 class="text-sm font-semibold text-ok">两步验证已开启</h2>
      <div class="mt-4 grid gap-3 sm:max-w-md">
        <div>
          <label class="label" for="disable-password">登录密码</label>
          <input id="disable-password" v-model="disablePassword" class="field" type="password" autocomplete="current-password" />
        </div>
        <div>
          <label class="label" for="disable-code">当前动态码</label>
          <input id="disable-code" v-model="disableCode" class="field font-mono" inputmode="numeric" />
        </div>
        <button class="btn btn-ghost" type="button" :disabled="busy" @click="disableMfa">关闭两步验证</button>
      </div>
    </div>

    <!-- 绑定流程 -->
    <div v-else class="card p-5">
      <h2 class="text-sm font-semibold">绑定身份验证器</h2>

      <template v-if="!setup">
        <p class="mt-1 text-sm text-ink-3">点击生成密钥与二维码，用验证器 App 扫码后输入 6 位动态码完成绑定。</p>
        <button class="btn btn-primary mt-4" type="button" :disabled="busy" @click="startSetup">
          {{ busy ? '生成中…' : '生成密钥与二维码' }}
        </button>
      </template>

      <template v-else>
        <div class="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
          <img class="size-40 rounded-lg border border-line" :src="setup.qrDataUrl" alt="TOTP 绑定二维码" />
          <div class="text-sm">
            <p class="text-ink-3">验证器无法扫码时手动输入密钥：</p>
            <p class="mt-1 font-mono break-all">{{ setup.secret }}</p>
          </div>
        </div>

        <div class="mt-4 grid gap-3 sm:max-w-xs">
          <div>
            <label class="label" for="enable-code">验证器动态码</label>
            <input id="enable-code" v-model="enableCode" class="field font-mono tracking-widest" inputmode="numeric" placeholder="000000" />
          </div>
          <button class="btn btn-primary" type="button" :disabled="busy || enableCode.trim().length === 0" @click="confirmEnable">
            {{ busy ? '校验中…' : '确认开启' }}
          </button>
        </div>
      </template>
    </div>
  </section>
</template>
