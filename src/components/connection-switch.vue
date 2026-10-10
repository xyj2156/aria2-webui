<script setup>
/**
 * 顶栏「当前 aria2 连接」切换器。
 *
 * 只做一件事：列出所有连接、点一条就切过去。写入统一走 connections store 的 setActive，
 * 它一次做掉三件事——更新 activeId（useStorage 持久化，下次进页仍是这条）、给该条记
 * lastUsedAt（供 rpcListDisplayOrder=recentlyUsed 排序）、把配置注入 rpc 引擎。
 * 引擎在地址/端口/协议/密钥任一变化时断开旧连接、下次调用按需重连，所以切完不必刷页。
 *
 * 本组件不碰连通性：切完的「已连接 / 连接失败：原因」提示由 global-stat-indicator
 * 监听 activeId 主动探测 aria2.getVersion 负责，这里重复探测会弹两条消息。
 *
 * 列表顺序与 WebUI 设置的连接 tab 共用 useSortedConnections，两处永远一致。
 */
import { computed, h } from 'vue';
import { NIcon } from 'naive-ui';
import { CheckmarkOutline, ChevronDownOutline, ServerOutline } from '@vicons/ionicons5';

import { t } from '@/i18n/index.js';
import { useConnectionStore } from '@/store/connections.js';
import { useSortedConnections } from '@/composables/use-sorted-connections.js';

const connections = useConnectionStore();
const { sortedConnections } = useSortedConnections();

/** 当前连接名；一条连接都没有时给占位文案（按钮不能是空的） */
const currentName = computed(() => connections.activeConnection?.name || t('connection.switch.none'));

/**
 * id → 连接记录，给 renderLabel 查副标题用。
 * 不把这些字段摊进 option 对象，是为了让 options 保持 Naive 的标准形状（key + label）。
 */
const byId = computed(() => new Map(sortedConnections.value.map((conn) => [conn.id, conn])));

const options = computed(() => {
  const list = sortedConnections.value.map((conn) => ({ key: conn.id, label: conn.name }));
  return list.length
    ? list
    : [{ key: '__none__', label: t('connection.switch.none'), disabled: true }];
});

/**
 * 主标题 = 连接名，副标题 = protocol://host:port。
 * 副标题是为了同名连接（尤其默认名都是 localhost）能一眼分辨，否则光看名字切错台。
 */
function renderLabel(option) {
  const conn = byId.value.get(option.key);
  if (!conn) {
    return option.label;
  }
  return h('div', { class: 'flex flex-col leading-tight py-0.5' }, [
    h('span', conn.name),
    h('span', { class: 'text-[11px] opacity-55' }, `${conn.protocol}://${conn.host}:${conn.port}`),
  ]);
}

/**
 * Naive 的 dropdown 不会给选中项自动打勾（value 只用于菜单高亮），勾要自己画。
 * 只给当前项返回图标：dropdown 会在每个选项前留一个 prefix 容器，有无图标都由它对齐。
 */
function renderIcon(option) {
  if (option.key !== connections.activeId) {
    return null;
  }
  return h(NIcon, { size: 16 }, { default: () => h(CheckmarkOutline) });
}

/** 点当前项直接忽略：省掉一次无意义的 setActive 与引擎重注入 */
function handleSelect(key) {
  if (key === connections.activeId) {
    return;
  }
  connections.setActive(key);
}
</script>

<template lang="pug">
n-dropdown(
  trigger="click"
  placement="bottom-end"
  :options="options"
  :value="connections.activeId"
  :render-label="renderLabel"
  :render-icon="renderIcon"
  @select="handleSelect"
)
  n-button(text :title="t('connection.switch.tooltip')" class="max-w-[220px]")
    n-icon(:component="ServerOutline" :size="16")
    span.ml-1(class="max-w-[160px] truncate") {{ currentName }}
    n-icon(:component="ChevronDownOutline" :size="12" class="opacity-60")
</template>
