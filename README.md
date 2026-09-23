# Vue 3 + Vite

Vue 3 `<script setup>` SFC 工程，构建工具链已接入 **Pug**、**UnoCSS（按需）**、**unplugin-auto-import（API 按需自动导入）** 与 **unplugin-vue-components（组件按需自动注册）**。

## 已接入能力

- **Pug**：模板用 `<template lang="pug">` 编写。
  ```pug
  <template lang="pug">
  div
    p hello
  </template>
  ```
  > 注意：UnoCSS 按源码文本扫描，pug 简写 `.foo`（如 `button.btn`）默认提取不到工具类；请用属性写法 `div(class="flex items-center gap-2")`。

- **UnoCSS（按需原子类）**：只生成源码里实际用到的类，未用则零体积。配置见 `uno.config.ts`：
  - `presetWind3`：Tailwind v4 风格原子类基础
  - `presetAttributify`：属性化写法（如 `<div text-red>`）
  - `presetTypography`：排版相关类
  - `presetIcons`：图标（`i-xxx`）；生产构建需按需安装图标集，如 `pnpm add -D @iconify-json/tabler`
  - `transformerDirectives`：支持 `@apply` 等指令
  - `transformerVariantGroup`：支持 `hover:(bg-red text-white)` 变体组
  - `shortcuts.btn`：已内置一个 `btn` 通用按钮快捷类
  - 入口：`src/main.js` 引入 `import 'virtual:uno.css'`

- **unplugin-auto-import**：Vue API（`ref`、`computed`、`watch` 等）免手动 import 直接用；类型声明自动生成在根目录 `auto-imports.d.ts`。
  ```vue
  <script setup>
  const count = ref(0)   // 无需 import { ref }
  </script>
  ```

- **unplugin-vue-components**：`src/components` 下的组件自动注册，模板里直接用标签即可，无需手动 `import`。
  ```vue
  <script setup>
  // 无需 import HelloWorld from './components/HelloWorld.vue'
  </script>
  <template lang="pug">
  HelloWorld
  </template>
  ```
  类型声明自动生成在根目录 `components.d.ts`。后续接组件库（Element Plus 等）时在 `Components({ resolvers: [...] })` 追加 resolver 即可。

## 开发

```bash
pnpm install
pnpm dev       # 启动开发服务器
pnpm build     # 生产构建
```
