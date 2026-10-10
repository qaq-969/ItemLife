import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const viewLoaders = {
  appShell: () => import('@/layouts/AppShell.vue'),
  dashboard: () => import('@/views/DashboardView.vue'),
  transactions: () => import('@/views/LedgerView.vue'),
  transactionNew: () => import('@/views/NewTransactionView.vue'),
  items: () => import('@/views/ItemsView.vue'),
  me: () => import('@/views/MeView.vue'),
  itemDetail: () => import('@/views/ItemDetailView.vue'),
  itemEdit: () => import('@/views/ItemFormView.vue'),
  family: () => import('@/views/FamilyView.vue'),
  accounts: () => import('@/views/AccountsView.vue'),
  categories: () => import('@/views/CategoriesView.vue'),
  security: () => import('@/views/SecurityView.vue'),
  siteAdmin: () => import('@/views/SiteAdminView.vue'),
  dashboardCharts: () => import('@/utils/dashboard-charts'),
};

const primaryViewLoaders = [
  viewLoaders.dashboard,
  viewLoaders.transactions,
  viewLoaders.transactionNew,
  viewLoaders.items,
  viewLoaders.me,
  viewLoaders.dashboardCharts,
];
const secondaryViewLoaders = [
  viewLoaders.itemDetail,
  viewLoaders.itemEdit,
  viewLoaders.family,
  viewLoaders.accounts,
  viewLoaders.categories,
  viewLoaders.security,
  viewLoaders.siteAdmin,
];

export function preloadAuthenticatedViews(stage: 'primary' | 'secondary'): Promise<PromiseSettledResult<unknown>[]> {
  const loaders = stage === 'primary' ? primaryViewLoaders : secondaryViewLoaders;
  return Promise.allSettled(loaders.map((load) => load()));
}

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
    component: viewLoaders.appShell,
    children: [
      { path: '', redirect: { name: 'dashboard' } },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: viewLoaders.dashboard,
        meta: { title: '首页', nav: 'dashboard' },
      },
      {
        path: 'transactions',
        name: 'transactions',
        component: viewLoaders.transactions,
        meta: { title: '流水', nav: 'transactions' },
      },
      {
        path: 'transactions/new',
        name: 'transaction-new',
        component: viewLoaders.transactionNew,
        meta: { title: '记一笔', nav: 'new' },
      },
      {
        path: 'items',
        name: 'items',
        component: viewLoaders.items,
        meta: { title: '物品', nav: 'items' },
      },
      {
        path: 'items/:id',
        name: 'item-detail',
        component: viewLoaders.itemDetail,
        meta: { title: '物品详情', nav: 'items' },
      },
      {
        path: 'items/:id/edit',
        name: 'item-edit',
        component: viewLoaders.itemEdit,
        meta: { title: '编辑物品', nav: 'items', parent: 'items' },
      },
      {
        path: 'me',
        name: 'me',
        component: viewLoaders.me,
        meta: { title: '我的', nav: 'me' },
      },
      { path: 'family', name: 'family', component: viewLoaders.family, meta: { title: '家庭', nav: 'family', parent: 'me' } },
      {
        path: 'accounts',
        name: 'accounts',
        component: viewLoaders.accounts,
        meta: { title: '账户管理', nav: 'me', parent: 'me' },
      },
      {
        path: 'categories',
        name: 'categories',
        component: viewLoaders.categories,
        meta: { title: '分类管理', nav: 'me', parent: 'me' },
      },
      {
        path: 'me/security',
        name: 'security',
        component: viewLoaders.security,
        meta: { title: '账号安全', nav: 'me', parent: 'me' },
      },
      {
        path: 'site-admin',
        name: 'site-admin',
        component: viewLoaders.siteAdmin,
        meta: { title: '站点管理', nav: 'me', parent: 'me', siteAdmin: true },
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
  scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
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

  if (to.meta.siteAdmin === true && !['super_admin', 'admin'].includes(auth.user?.siteRole ?? '')) {
    return { name: 'dashboard' };
  }

  return true;
});

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : '';
  document.title = title ? `${title} · ItemLife` : 'ItemLife';
});
