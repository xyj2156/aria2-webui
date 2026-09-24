import { createRouter, createWebHashHistory } from 'vue-router';
import { t } from '@/i18n/index.js';
import Layout from '@/layout/index.vue';

const routes = [{
  path:      '/',
  name:      'index',
  component: Layout,
  redirect:  {name: 'downloading'},
  children:  [
    {
      path:      '/downloading',
      name:      'downloading',
      meta:      {title: 'menu.downloading'},
      component: () => import('@/views/index.vue'),
    },
    {
      path:      '/waiting',
      name:      'waiting',
      meta:      {title: 'menu.waiting'},
      component: () => import('@/views/waiting.vue'),
    },
    {
      path:      '/stopped',
      name:      'stopped',
      meta:      {title: 'menu.stopped'},
      component: () => import('@/views/stopped.vue'),
    },
    {
      path:      '/webui-settings',
      name:      'webui-settings',
      meta:      {title: 'menu.webui-settings'},
      component: () => import('@/views/webui-settings.vue'),
    },
    {
      path:      '/settings',
      name:      'settings',
      meta:      {title: 'menu.settings'},
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
  document.title = t(to?.meta?.title || 'Aria2 Web UI');
  console.log('afterEach', to, from);
});

export default router;