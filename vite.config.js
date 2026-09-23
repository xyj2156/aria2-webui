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
});
