import { createApp } from 'vue'
import 'virtual:uno.css'
// 必须排在 './main.vue' / './router' 之前：hash 路由在模块求值阶段就按当前地址定初始
// 路由，启动链接里的 #rpc-secret= 要先被这个模块的 import 副作用摘掉（详见该文件）。
import '@/composables/use-url-secret.js';
import main from './main.vue'
import router from './router'

const app = createApp(main);
app.use(router);
app.use(createPinia());
app.mount('#app');
