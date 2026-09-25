<script setup>
import { CloseOutline } from '@vicons/ionicons5';
import { useDialog, useMessage } from 'naive-ui';
import { t, LANGUAGES } from '@/i18n/index.js';
import { useWebuiSettingsStore } from '@/store/webui-settings.js';
import { requestNotificationPermission } from '@/composables/use-browser-notification.js';
import { getTimeOptions, REFRESH_INTERVAL_OPTIONS } from '@/utils/interval-options.js';
// 版本号直接取工程 package.json（Vite 支持 JSON 具名导入），供「版本」只读行展示
import { version as appVersion } from '../../package.json';

const connections = useConnectionStore();
const settings = useWebuiSettingsStore();
const message = useMessage();
const dialog = useDialog();

const importVisible = ref(false);
const exportVisible = ref(false);
const importText = ref('');
const exportText = ref('');

const protocolOptions = [
  {label: 'ws://', value: 'ws'},
  {label: 'wss://', value: 'wss'},
  {label: 'http://', value: 'http'},
  {label: 'https://', value: 'https'},
];

// ─────────────────────────────────────────────────────────── 全局设置：读写通道
/** 选项当前值（store.options 已被 Pinia 解包为对象） */
const opts = computed(() => settings.options);

/** 通用写入：改一个键就走 store（useStorage 即时持久化） */
function upd(key, value) {
  settings.set(key, value);
}

/**
 * 连接 tab 的展示顺序，受设置 rpcListDisplayOrder 驱动（单一事实源，改值即时生效）：
 *  - recentlyUsed：最近激活的在前（依赖 connections store 的 lastUsedAt）；从未激活的按创建序垫底（sort 稳定）
 *  - rpcAlias：按连接名字典序（数字感知、忽略大小写）
 */
const sortedConnections = computed(() => {
  const list = [...connections.connections];
  if (settings.options.rpcListDisplayOrder === 'rpcAlias') {
    return list.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { numeric: true, sensitivity: 'base' }));
  }
  return list.sort((a, b) => (Number(b.lastUsedAt) || 0) - (Number(a.lastUsedAt) || 0));
});

/** 语言 / 主题：只写 store；分别由 use-language-sync、use-theme-sync 的监听器同步到 i18n 与 isDark */
function onLanguageChange(code) {
  upd('language', code);
}

function onThemeChange(value) {
  upd('theme', value);
}

/**
 * 浏览器通知开关：点「开」必须在用户手势里申请 Notification 权限，
 * 只有 granted 才持久化 true；被拒或不支持 → 回退 false 并提示。关则直接置 false。
 * @param {boolean} value
 */
async function onBrowserNotificationChange(value) {
  if (!value) {
    upd('browserNotification', false);
    return;
  }
  const permission = await requestNotificationPermission();
  if (permission === 'granted') {
    upd('browserNotification', true);
    message.success(t('webui.notif-granted'));
  } else if (permission === 'unsupported') {
    upd('browserNotification', false);
    message.error(t('webui.notif-unsupported'));
  } else {
    upd('browserNotification', false);
    message.warning(t('webui.notif-denied'));
  }
}

const languageOptions = computed(() => LANGUAGES.map((item) => ({label: item.label, value: item.code})));

const themeOptions = computed(() => [
  {label: t('webui.theme-light'), value: 'light'},
  {label: t('webui.theme-dark'), value: 'dark'},
  {label: t('webui.theme-system'), value: 'system'},
]);

const frequencyOptions = computed(() => [
  {label: t('webui.unlimited'), value: 'unlimited'},
  {label: t('webui.freq-high'), value: 'high'},
  {label: t('webui.freq-middle'), value: 'middle'},
  {label: t('webui.freq-low'), value: 'low'},
]);

const rpcOrderOptions = computed(() => [
  {label: t('webui.recently-used'), value: 'recentlyUsed'},
  {label: t('webui.rpc-alias'), value: 'rpcAlias'},
]);

const afterCreateOptions = computed(() => [
  {label: t('webui.goto-task-list'), value: 'task-list'},
  {label: t('webui.goto-task-detail'), value: 'task-detail'},
  {label: t('webui.stay-current'), value: 'stay-current-page'},
]);

const afterRetryOptions = computed(() => [
  {label: t('webui.goto-downloading'), value: 'task-list-downloading'},
  {label: t('webui.goto-task-list'), value: 'task-list'},
  {label: t('webui.refresh-current-page'), value: 'refresh-page'},
  {label: t('webui.stay-current'), value: 'stay-current-page'},
]);

function piecesLabel(value) {
  return t('webui.pieces-le', {value});
}
const piecesOptions = computed(() => [
  {label: t('webui.always'), value: 'always'},
  {label: piecesLabel(102400), value: 'le102400'},
  {label: piecesLabel(10240), value: 'le10240'},
  {label: piecesLabel(1024), value: 'le1024'},
  {label: t('webui.never'), value: 'never'},
]);

const titleIntervalOptions = computed(() => getTimeOptions(REFRESH_INTERVAL_OPTIONS));
const statIntervalOptions = computed(() => getTimeOptions(REFRESH_INTERVAL_OPTIONS, true));
const wsIntervalOptions = computed(() => getTimeOptions(REFRESH_INTERVAL_OPTIONS, true));

// ─────────────────────────────────────────────────────────── 导入 / 导出 / 重置
function openExport() {
  exportText.value = JSON.stringify(settings.exportOptions(), null, 2);
  exportVisible.value = true;
}

async function copyExport() {
  try {
    await navigator.clipboard.writeText(exportText.value);
    message.success(t('webui.operation-succeeded'));
  } catch {
    message.error(t('webui.copy-failed'));
  }
}

function downloadExport() {
  const blob = new Blob([exportText.value], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'aria2-webui-settings.json';
  link.click();
  URL.revokeObjectURL(url);
}

function pickImportFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) {
      void file.text().then((text) => {
        importText.value = text;
      });
    }
  });
  input.click();
}

function applyImport() {
  let parsed;
  try {
    parsed = JSON.parse(importText.value || 'null');
  } catch {
    message.error(t('webui.import-invalid'));
    return;
  }
  const result = settings.importOptions(parsed);
  if (!result.ok) {
    message.error(t('webui.import-invalid'));
    return;
  }
  importVisible.value = false;
  // 语言 / 主题的变化由 use-language-sync、use-theme-sync 的监听器自动同步，这里无需再手动应用
  message.success(t('webui.operation-succeeded'));
}

function resetAll() {
  dialog.warning({
    title:       t('webui.reset-settings'),
    content:     t('webui.confirm-reset'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      settings.resetToDefaults();
      message.success(t('webui.operation-succeeded'));
    },
  });
}

function addConnection() {
  connections.addConnection();
}
</script>

<template lang="pug">
//- 外层 n-layout-content 是 overflow:auto；这里用固定视口高度 + overflow-hidden 收住页面，
//- tab 内容交给 Naive 自带的 <n-scrollbar>（视口高度约束、自带滚动条），标题栏在滚动区之上、天然固定。
.flex.flex-col.overflow-hidden(class="h-[calc(100vh-5.5rem)]")
  n-tabs(type="card" addable @add="addConnection")
    // ══════════════════════════════════════════════════ 全局
    n-tab-pane(:tab="t('webui.global')" name="global")
      n-scrollbar(class="h-[calc(100vh-8rem)]")
        setting-field(:label="t('webui.version')" )
          span.opacity-60(class="text-[13px]") v{{ appVersion }}
        setting-field(:label="t('webui.language')")
          n-select(:value="opts.language" :options="languageOptions" class="w-[200px]" @update:value="onLanguageChange")
        setting-field(:label="t('webui.theme')")
          n-select(:value="opts.theme" :options="themeOptions" class="w-[200px]" @update:value="onThemeChange")
        setting-field(:label="t('webui.debug-mode')")
          n-switch(:value="opts.enableDebugMode" @update:value="(v) => upd('enableDebugMode', v)")
        setting-field(:label="t('webui.page-title')" description-key="webui.page-title-help")
          n-input(:value="opts.title" @update:value="(v) => upd('title', v)")
        setting-field(:label="t('webui.browser-notification')")
          n-switch(:value="opts.browserNotification" @update:value="onBrowserNotificationChange")
        setting-field(:label="t('webui.browser-notification-sound')")
          n-switch(:value="opts.browserNotificationSound" @update:value="(v) => upd('browserNotificationSound', v)")
        setting-field(:label="t('webui.browser-notification-frequency')")
          n-select(:value="opts.browserNotificationFrequency" :options="frequencyOptions" class="w-[260px]" @update:value="(v) => upd('browserNotificationFrequency', v)")
        setting-field(
          v-if="settings.isCurrentRpcUseWebSocket"
          :label="t('webui.ws-reconnect-interval')"
          description-key="webui.ws-reconnect-interval-help"
        )
          n-select(:value="opts.webSocketReconnectInterval" :options="wsIntervalOptions" class="w-[200px]" @update:value="(v) => upd('webSocketReconnectInterval', v)")
        setting-field(:label="t('webui.title-refresh-interval')")
          n-select(:value="opts.titleRefreshInterval" :options="titleIntervalOptions" class="w-[200px]" @update:value="(v) => upd('titleRefreshInterval', v)")
        setting-field(:label="t('webui.global-stat-refresh-interval')" needs-reload)
          n-select(:value="opts.globalStatRefreshInterval" :options="statIntervalOptions" class="w-[200px]" @update:value="(v) => upd('globalStatRefreshInterval', v)")
        setting-field(:label="t('webui.task-refresh-interval')")
          n-select(:value="opts.downloadTaskRefreshInterval" :options="titleIntervalOptions" class="w-[200px]" @update:value="(v) => upd('downloadTaskRefreshInterval', v)")
        setting-field(:label="t('webui.keyboard-shortcuts')" description-key="webui.keyboard-shortcuts-help")
          n-switch(:value="opts.keyboardShortcuts" @update:value="(v) => upd('keyboardShortcuts', v)")
        setting-field(:label="t('webui.swipe-gesture')")
          n-switch(:value="opts.swipeGesture" @update:value="(v) => upd('swipeGesture', v)")
        setting-field(:label="t('webui.drag-and-drop-tasks')")
          n-switch(:value="opts.dragAndDropTasks" @update:value="(v) => upd('dragAndDropTasks', v)")
        setting-field(:label="t('webui.rpc-list-display-order')")
          n-select(:value="opts.rpcListDisplayOrder" :options="rpcOrderOptions" class="w-[200px]" @update:value="(v) => upd('rpcListDisplayOrder', v)")
        setting-field(:label="t('webui.independent-display-order')")
          n-switch(:value="opts.taskListIndependentDisplayOrder" @update:value="(v) => upd('taskListIndependentDisplayOrder', v)")
        setting-field(:label="t('webui.after-creating-new-task')")
          n-select(:value="opts.afterCreatingNewTask" :options="afterCreateOptions" class="w-[260px]" @update:value="(v) => upd('afterCreatingNewTask', v)")
        setting-field(:label="t('webui.after-retrying-task')")
          n-select(:value="opts.afterRetryingTask" :options="afterRetryOptions" class="w-[260px]" @update:value="(v) => upd('afterRetryingTask', v)")
        setting-field(:label="t('webui.remove-old-task-after-retrying')")
          n-switch(:value="opts.removeOldTaskAfterRetrying" @update:value="(v) => upd('removeOldTaskAfterRetrying', v)")
        setting-field(:label="t('webui.confirm-task-removal')")
          n-switch(:value="opts.confirmTaskRemoval" @update:value="(v) => upd('confirmTaskRemoval', v)")
        setting-field(:label="t('webui.include-prefix-when-copying')")
          n-switch(:value="opts.includePrefixWhenCopyingFromTaskDetails" @update:value="(v) => upd('includePrefixWhenCopyingFromTaskDetails', v)")
        setting-field(:label="t('webui.show-pieces-info')")
          n-select(:value="opts.showPiecesInfoInTaskDetailPage" :options="piecesOptions" class="w-[260px]" @update:value="(v) => upd('showPiecesInfoInTaskDetailPage', v)")
        .flex.gap-2.p-3
          n-button(size="small" @click="importVisible = true") {{ t('webui.import-settings') }}
          n-button(size="small" @click="openExport") {{ t('webui.export-settings') }}
          n-button(size="small" type="error" @click="resetAll") {{ t('webui.reset-settings') }}

    // ══════════════════════════════════════════════════ 连接（RPC Profile）
    n-tab-pane(v-for="item in sortedConnections" :key="item.id" :name="item.id")
      template(#tab)
        .flex.items-center.gap-1
          span {{ item.name }}
          n-popconfirm(
            :positive-text="t('connection.remove.positive')"
            :negative-text="t('connection.remove.negative')"
            @positive-click="() => connections.removeConnection(item.id)"
          )
            template(#trigger)
              n-button(text size="tiny" @click.stop)
                template(#icon)
                  n-icon(:size="14")
                    close-outline
            | {{ t('connection.remove.content') }}
      n-scrollbar(class="h-[calc(100vh-8rem)]")
        setting-field(:label="t('connection.name')")
          n-input(:value="item.name" @update:value="val => connections.updateConnection(item.id, { name: val })")
        setting-field(:label="t('connection.host')")
          .flex.items-center.gap-1.w-full
            n-select(:value="item.protocol" @update:value="val => connections.updateConnection(item.id, { protocol: val })" :options="protocolOptions" class="w-[100px]")
            n-input(:value="item.host" @update:value="val => connections.updateConnection(item.id, { host: val })" class="flex-1")
            span.px-1 :
            n-input-number(:value="item.port" @update:value="val => connections.updateConnection(item.id, { port: val })" :min="1" :max="65534" class="w-[105px]")
            n-input(:value="item.path" @update:value="val => connections.updateConnection(item.id, { path: val })" class="flex-1")
        setting-field(:label="t('connection.secret')")
          n-input(type="password" show-password-on="click" :value="item.secret" @update:value="val => connections.updateConnection(item.id, { secret: val })")

  // ── 导入 / 导出弹窗
  n-modal(v-model:show="importVisible" preset="card" :title="t('webui.import-settings')" class="w-[620px] max-w-[90vw]")
    n-input(type="textarea" :rows="10" :value="importText" @update:value="(v) => importText = v")
    template(#footer)
      .flex.gap-2.justify-end
        n-button(size="small" @click="pickImportFile") {{ t('webui.import') }}
        n-button(size="small" type="primary" @click="applyImport") {{ t('common.confirm') }}
  n-modal(v-model:show="exportVisible" preset="card" :title="t('webui.export-settings')" class="w-[620px] max-w-[90vw]")
    n-input(type="textarea" :rows="12" readonly :value="exportText")
    template(#footer)
      .flex.gap-2.justify-end
        n-button(size="small" @click="copyExport") {{ t('webui.copy') }}
        n-button(size="small" @click="downloadExport") {{ t('webui.download') }}
</template>

