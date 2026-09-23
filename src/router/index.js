import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [{
  path: '/',
  name: 'index',
  component: () => import('@/layout/index.vue'),
  children: [
    {
      path: '/',
      name: 'downloading',
      component: () => import('@/views/index.vue'),
    },
    {
      path: '/waiting',
      name: 'waiting',
      component: () => import('@/views/waiting.vue'),
    },
    {
      path: '/stopped',
      name: 'stopped',
      component: () => import('@/views/stopped.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/settings.vue'),
    },
  ],
}];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach(function (to, from) {
  document.title = 'Loading ...';
  console.log('beforeEach', to, from);
});
router.afterEach(function (to, from) {
  document.title = to?.meta?.title || 'Aria2 Web UI';
  console.log('afterEach', to, from);
});

export default router;
