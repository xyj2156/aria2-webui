import { createApp } from 'vue'
import 'virtual:uno.css'
import main from './main.vue'
import router from './router'

const app = createApp(main);
app.use(router);
app.use(createPinia());
app.mount('#app');
