import { createRouter, createWebHashHistory } from "vue-router";

const router = createRouter({
  history: createWebHashHistory(),
  routes:  [
    {
      path:      '/',
      name:      'home',
      component: () => import('@/views/index.vue'),
    },
  ],
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
