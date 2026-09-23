import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import UnoCSS from 'unocss/vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// 基于配置文件所在目录解析路径，不依赖 process.cwd()、不写死 src
const r = (p) => fileURLToPath(new URL(p, import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    UnoCSS(),
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia'],
      dts:     'auto-imports.d.ts',
    }),
    Components({
      dirs: [r('./src/components')],
      dts:  'components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': r('./src'),
    },
  },
})
