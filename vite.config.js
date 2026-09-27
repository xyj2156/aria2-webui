import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers';
import UnoCSS from 'unocss/vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// 基于配置文件所在目录解析路径，不依赖 process.cwd()、不写死 src
const src = (...args) => fileURLToPath(new URL(`./src/${args.join('/')}`, import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    UnoCSS(),
    AutoImport({
      dirs: [
        src('rpc', 'index.js'),
        src('store'),
      ],
      imports: [
        'vue', 'vue-router', 'pinia', '@vueuse/core',
        {
          'naive-ui': [
            'useDialog',
            'useMessage',
            'useNotification',
            'useLoadingBar',
          ],
        },
      ],
      dts: 'auto-imports.d.ts',
    }),
    Components({
      dirs: [src('components')],
      resolvers: [NaiveUiResolver()],
      dts: 'components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': src(),
    },
  },

  build: {
    rollupOptions: {
      output: {
        /**
         * echarts / zrender 必须独立成组。不指定的话 rollup 会按「模块使用集合」自动分组，
         * 把图表引擎和 Naive UI 的静态依赖（date locale 那批）合进同一个 chunk —— 结果是首屏
         * 只要加载 Naive 的 Input chunk 就会顺带拉下几百 KB 的图表引擎，三个图表组件的
         * defineAsyncComponent / 动态 import 全部白做。显式分组后图表引擎只随图表 chunk 走。
         */
        manualChunks(id) {
          if (/[\\/](echarts|zrender)[\\/]/.test(id)) {
            return 'echarts';
          }
          return null;
        },
      },
    },
  },
});
