/**
 * WebUI（前端自身）设置仓库（Pinia Store）。
 *
 * 与 aria2 全局选项（useGlobalOptions，走 RPC）无关：这里只存「页面本身」的偏好——
 * 语言、主题、页面标题、浏览器通知、各类刷新/重连间隔、快捷键、手势、拖拽排序、
 * RPC 列表顺序、新建/重试后动作、删除确认、复制前缀、区块信息展示等。
 *
 * 字段与默认值 1:1 对齐参考实现 project 的 stores/setting.ts 的 DEFAULT_OPTIONS，
 * 但剔除了「RPC Profile」相关键（rpcAlias/rpcHost/... 与 extendRpcServers）——那部分在本
 * 工程里由 @/store/connections.js 独立管理（对应 webui-settings 页的连接 tab），不重复建模。
 *
 * 持久化：整份 options 用 useStorage 存到 localStorage（key: aria2-webui.settings），
 * 刷新不丢。写入统一走 patch/set，避免第二处写存储。
 *
 * 注意（中策口径）：多数间隔/通知/快捷键/手势类项当前工程尚无消费端，此处只负责持久化，
 * 待对应功能补齐后自然生效。语言、主题两行是「单一事实源」——由 @/composables 下的
 * use-language-sync / use-theme-sync 监听 store 变化并同步到 i18n 引擎与 isDark，改完即见效果。
 */
import { resolveBrowserLocale } from '@/i18n/index.js';

/**
 * @typedef {Object} WebuiSettings
 * @property {string}  language                                   界面语言代码（zh-CN / en-US）——单一事实源，
 *                                                                 由 @/composables/use-language-sync 同步到 i18n 引擎
 * @property {'light'|'dark'|'system'} theme                      主题模式
 * @property {string}  title                                      页面标题模板
 * @property {number}  titleRefreshInterval                       页面标题更新间隔（ms）
 * @property {boolean} browserNotification                        是否启用浏览器通知
 * @property {boolean} browserNotificationSound                   浏览器通知声音
 * @property {'unlimited'|'high'|'middle'|'low'} browserNotificationFrequency 浏览器通知频次
 * @property {number}  webSocketReconnectInterval                 WebSocket 自动重连间隔（ms，0=禁用）
 * @property {number}  globalStatRefreshInterval                  全局状态更新间隔（ms，0=禁用）
 * @property {number}  downloadTaskRefreshInterval                任务信息更新间隔（ms）
 * @property {boolean} keyboardShortcuts                          键盘快捷键
 * @property {boolean} swipeGesture                               滑动手势
 * @property {boolean} dragAndDropTasks                           拖拽任务排序
 * @property {'recentlyUsed'|'rpcAlias'} rpcListDisplayOrder      RPC 列表显示顺序
 * @property {boolean} taskListIndependentDisplayOrder            各任务列表页独立显示顺序
 * @property {'task-list'|'task-detail'|'stay-current-page'} afterCreatingNewTask   创建新任务后动作
 * @property {'task-list-downloading'|'task-list'|'refresh-page'|'stay-current-page'} afterRetryingTask 重试后动作
 * @property {boolean} removeOldTaskAfterRetrying                 重试后删除原任务
 * @property {boolean} confirmTaskRemoval                         删除前确认
 * @property {boolean} includePrefixWhenCopyingFromTaskDetails    详情页复制含前缀
 * @property {'always'|'le102400'|'le10240'|'le1024'|'never'} showPiecesInfoInTaskDetailPage 详情页区块信息
 * @property {boolean} enableDebugMode                            调试模式
 */

/** 与 project DEFAULT_OPTIONS 对齐的默认值（去掉 rpc* / extendRpcServers）。
 *  language 默认取浏览器语言（与 i18n 引擎初值一致），避免同步时把新用户强制成中文。 */
export const DEFAULT_SETTINGS = /** @type {WebuiSettings} */ ({
  language: resolveBrowserLocale(),
  theme: 'system',
  title: '${downspeed}, ${upspeed} - ${title}',
  titleRefreshInterval: 5000,
  browserNotification: false,
  browserNotificationSound: true,
  browserNotificationFrequency: 'unlimited',
  webSocketReconnectInterval: 5000,
  globalStatRefreshInterval: 1000,
  downloadTaskRefreshInterval: 1000,
  keyboardShortcuts: true,
  swipeGesture: true,
  dragAndDropTasks: true,
  rpcListDisplayOrder: 'recentlyUsed',
  taskListIndependentDisplayOrder: false,
  afterCreatingNewTask: 'task-list',
  afterRetryingTask: 'task-list-downloading',
  removeOldTaskAfterRetrying: false,
  confirmTaskRemoval: true,
  includePrefixWhenCopyingFromTaskDetails: true,
  showPiecesInfoInTaskDetailPage: 'le10240',
  enableDebugMode: false,
});

/** 存储/导入导出时脱敏的敏感键（当前无，预留；与 connections 的 secret 分开） */
const STORAGE_KEY = 'aria2-webui.settings';

/**
 * 只保留默认表里存在、且类型一致的键，丢弃脏字段——用于初始化与导入。
 * @param {unknown} raw
 * @returns {WebuiSettings}
 */
function normalize(raw) {
  /** @type {WebuiSettings} */
  const merged = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return merged;
  }
  const source = /** @type {Record<string, unknown>} */ (raw);
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in source)) {
      continue;
    }
    const expect = typeof DEFAULT_SETTINGS[key];
    const value = source[key];
    // 类型不符的脏值直接丢弃，避免把 null/数组塞进布尔项
    if (expect === 'number' && typeof value === 'number' && Number.isFinite(value)) {
      merged[key] = value;
    } else if (expect !== 'number' && typeof value === expect) {
      merged[key] = value;
    }
  }
  return merged;
}

export const useWebuiSettingsStore = defineStore('webuiSettings', function () {
  // useStorage 负责读写 localStorage；对象形态自动 JSON 序列化。
  /** @type {import('vue').Ref<WebuiSettings>} */
  const options = useStorage(STORAGE_KEY, { ...DEFAULT_SETTINGS });

  // 启动即清洗一次历史脏存储（缺字段 / 类型漂移时回落到默认）。
  options.value = normalize(options.value);

  const connections = useConnectionStore();

  /** 当前活跃连接是否使用 WebSocket（ws/wss）——决定是否展示「WebSocket 自动重连间隔」 */
  const isCurrentRpcUseWebSocket = computed(() => {
    const protocol = connections.activeConnection?.protocol;
    return protocol === 'ws' || protocol === 'wss';
  });

  /**
   * 合并写入若干键，写后统一清洗。
   * @param {Partial<WebuiSettings>} next
   */
  function patch(next) {
    options.value = normalize({ ...options.value, ...next });
  }

  /**
   * 写单个键。
   * @param {keyof WebuiSettings} key
   * @param {unknown} value
   */
  function set(key, value) {
    patch({ [key]: value });
  }

  /** 恢复默认（保留结构、清掉自定义值） */
  function resetToDefaults() {
    options.value = { ...DEFAULT_SETTINGS };
  }

  /** 导出当前设置为可序列化对象（供「导出设置」下载/复制） */
  function exportOptions() {
    return { ...options.value };
  }

  /**
   * 导入设置：只接受白名单键、类型校验后合并。
   * @param {unknown} raw 解析后的对象
   * @returns {{ ok: boolean; reason?: string }}
   */
  function importOptions(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, reason: 'invalid' };
    }
    patch(/** @type {Partial<WebuiSettings>} */ (raw));
    return { ok: true };
  }

  return {
    options,
    isCurrentRpcUseWebSocket,
    patch,
    set,
    resetToDefaults,
    exportOptions,
    importOptions,
  };
});
