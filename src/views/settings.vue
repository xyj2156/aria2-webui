<script setup>
/**
 * aria2 全局设置页（块 08 §5）：页内 n-tabs 切 8 个分类，每个分类就是一行行 SettingItem，
 * 改动经 SettingItem 去抖后 emit change，本页写 changeGlobalOption 并回执行内状态。
 * 侧栏里「Aria2 设置」是一个顶层项（同 WebUI 设置），不拆子路由。
 *
 * 注意：部分 aria2 选项改后需重启进程才生效（aria2 语义），此处只负责即时下发。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { t } from '@/i18n/index.js';
import SettingItem from '@/components/setting/setting-item.vue';
import { useGlobalOptions } from '@/composables/use-global-options.js';
import { getAvailableGlobalOptionsKeys, getSpecifiedOptions, GLOBAL_CATEGORIES } from '@/services/option-service.js';

// 分类键 → 菜单文案键（复用已有 menu.* 译文）
const CATEGORY_LABEL_KEYS = {
  basic: 'menu.base-settings',
  'http-ftp-sftp': 'menu.protocol-settings',
  http: 'menu.http-setting',
  'ftp-sftp': 'menu.ftp-sftp-setting',
  bt: 'menu.bittorrent-setting',
  metalink: 'menu.metalink-setting',
  rpc: 'menu.rpc-setting',
  advanced: 'menu.advanced-setting',
};

const global = useGlobalOptions();
const activeCategory = ref(GLOBAL_CATEGORIES[0] ?? 'basic');
/** 行内回执：option.key → SettingItem 实例（同分类内键唯一，且只有当前 pane 挂载） */
const itemRefs = new Map();

const itemsByCategory = computed(() => {
  const map = {};
  for (const category of GLOBAL_CATEGORIES) {
    map[category] = getSpecifiedOptions(getAvailableGlobalOptionsKeys(category));
  }
  return map;
});

function setItemRef(el, key) {
  if (el) {
    itemRefs.set(key, el);
  } else {
    itemRefs.delete(key);
  }
}

async function onItemChange(payload) {
  const result = await global.write(payload.key, payload.value);
  itemRefs.get(payload.key)?.reportResult(result.ok, result.message ?? '');
}

async function retry() {
  await global.load(true);
}

watch(activeCategory, () => void global.load());
onMounted(() => void global.load());
</script>

<template lang="pug">
//- 与 WebUI 设置页同一套「固定视口 + 内部滚动」配方：页面根节点收住可视高度并 overflow-hidden，
//- 标题区（.head）与 tab 栏都在滚动区之上、天然固定，滚动条只出现在当前分类的设置项列表里。
//- n-tabs 自身撑满剩余高度（flex-1 min-h-0），pane-wrapper / pane 用 Naive 官方
//- pane-wrapper-style / pane-style 两个 props 传递高度约束，不去穿透 .n-tabs-* 内部类名。
.flex.flex-col.gap-3.overflow-hidden(class="h-[calc(100vh-5.5rem)]")
  .head.shrink-0
    h2.title {{ t('menu.group.aria2-settings') }}
    .subtitle {{ t('settings.immediate-hint') }}

  n-tabs(
    type="line"
    animated
    v-model:value="activeCategory"
    class="flex-1 min-h-0"
    :pane-wrapper-style="{ flex: '1', minHeight: '0' }"
    :pane-style="{ height: '100%', boxSizing: 'border-box' }"
  )
    n-tab-pane(
      v-for="category in GLOBAL_CATEGORIES"
      :key="category"
      :name="category"
      :tab="t(CATEGORY_LABEL_KEYS[category] || category)"
    )
      .pane.h-full.box-border(:style="category === activeCategory ? '' : 'display:none'")
        n-scrollbar(class="h-full")
          n-spin(:show="global.loading.value && !global.loaded.value")
            p.connect-error(v-if="!global.loaded.value && !global.loading.value")
              | {{ t('settings.connect-error') }}
              n-button(size="small" @click="retry") {{ t('task.action.retry') }}
            form(v-else)
              setting-item(
                v-for="item in itemsByCategory[category]"
                :key="item.key"
                :ref="(el) => setItemRef(el, item.key)"
                :option="item"
                :model-value="global.valueOf(item.key)"
                @change="onItemChange"
              )
</template>

<style scoped>
.title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.subtitle {
  font-size: 12px;
  opacity: 0.6;
}
.pane {
  padding-top: 4px;
}
.connect-error {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #d03050;
}
</style>
