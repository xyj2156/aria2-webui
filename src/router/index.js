import { createRouter, createWebHashHistory } from 'vue-router';
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

// 浏览器标签标题（document.title）改由页面标题引擎统一管理
// （@/composables/use-page-title.js 监听 currentRoute.meta.title 即时重渲染）。
// 这里不再直接写 document.title，避免路由与标题引擎两处互相覆盖。

export default router;