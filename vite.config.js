import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import UnoCSS from 'unocss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    UnoCSS(),
    AutoImport({
      imports: ['vue'],
      dts: 'auto-imports.d.ts',
    }),
    Components({
      dirs: ['src/components'],
      dts: 'components.d.ts',
    }),
  ],
})
