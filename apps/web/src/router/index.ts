import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/auth/LoginView.vue'),
    meta: { public: true, title: '登录' },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/auth/RegisterView.vue'),
    meta: { public: true, title: '注册' },
  },
  {
    path: '/mfa/verify',
    name: 'mfa-verify',
    component: () => import('@/views/auth/MfaVerifyView.vue'),
    meta: { public: true, title: '两步验证' },
  },
  {
    path: '/',
    component: () => import('@/layouts/AppShell.vue'),
    children: [
      { path: '', redirect: { name: 'dashboard' } },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/DashboardView.vue'),
        meta: { title: '首页', nav: 'dashboard' },
      },
      {
        path: 'transactions',
        name: 'transactions',
        component: () => import('@/views/LedgerView.vue'),
        meta: { title: '流水', nav: 'transactions' },
      },
      {
        path: 'transactions/new',
        name: 'transaction-new',
        component: () => import('@/views/NewTransactionView.vue'),
        meta: { title: '记一笔', nav: 'new' },
      },
      {
        path: 'items',
        name: 'items',
        component: () => import('@/views/ItemsView.vue'),
        meta: { title: '物品', nav: 'items' },
      },
      {
        path: 'items/:id',
        name: 'item-detail',
        component: () => import('@/views/ItemDetailView.vue'),
        meta: { title: '物品详情' },
      },
      {
        path: 'items/:id/edit',
        name: 'item-edit',
        component: () => import('@/views/ItemFormView.vue'),
        meta: { title: '编辑物品' },
      },
      {
        path: 'me',
        name: 'me',
        component: () => import('@/views/MeView.vue'),
        meta: { title: '我的', nav: 'me' },
      },
      { path: 'family', name: 'family', component: () => import('@/views/FamilyView.vue'), meta: { title: '家庭' } },
      {
        path: 'accounts',
        name: 'accounts',
        component: () => import('@/views/AccountsView.vue'),
        meta: { title: '账户管理' },
      },
      {
        path: 'categories',
        name: 'categories',
        component: () => import('@/views/CategoriesView.vue'),
        meta: { title: '分类管理' },
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('@/views/SettingsView.vue'),
        meta: { title: '设置' },
      },
      {
        path: 'settings/security',
        name: 'security',
        component: () => import('@/views/SecurityView.vue'),
        meta: { title: '账号安全' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { public: true, title: '页面不存在' },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  const isPublic = to.meta.public === true;

  if (!isPublic && !auth.isAuthenticated) {
    return {
      name: 'login',
      query: to.fullPath === '/' ? {} : { redirect: to.fullPath },
    };
  }

  if (isPublic && auth.isAuthenticated && (to.name === 'login' || to.name === 'register')) {
    return { name: 'dashboard' };
  }

  return true;
});

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : '';
  document.title = title ? `${title} · ItemLife` : 'ItemLife';
});
