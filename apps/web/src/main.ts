import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import App from './App.vue';
import { configureSession } from './api/http';
import { router } from './router';
import { useAuthStore } from './stores/auth';
import './assets/styles/main.css';

async function bootstrap(): Promise<void> {
  const app = createApp(App);
  const pinia = createPinia();

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  });

  app.use(pinia);
  app.use(VueQueryPlugin, { queryClient });

  const auth = useAuthStore(pinia);
  configureSession({
    getToken: () => auth.accessToken,
    setToken: (token) => auth.setToken(token),
    onExpired: () => {
      auth.clearSession();
      void router.push({ name: 'login' });
    },
  });

  // 先恢复会话再挂载，避免首屏出现登录页闪烁
  await auth.bootstrap();

  app.use(router);
  await router.isReady();
  app.mount('#app');
}

void bootstrap();
