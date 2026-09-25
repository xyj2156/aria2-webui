/**
 * 调试日志：受全局设置 enableDebugMode 门控。
 *
 * 关闭（默认）时 debugLog 是 no-op，不污染普通用户控制台；开启时透传到
 * console.log 并加 `[debug]` 前缀。用于连接状态变化等开发期噪音日志。
 *
 * 真正的错误 / 告警（i18n 缺键、语言包加载失败等）不要走这里——那些应始终可见，
 * 直接用 console.error / console.warn。enableDebugMode 只放大「额外诊断」，不抑制既有错误。
 *
 * 惰性取 store：debugLog 都在应用启动（pinia 已 install）之后被调用，故安全。
 */
import { useWebuiSettingsStore } from '@/store/webui-settings.js';

/**
 * @param {unknown[]} args 与 console.log 一致的可变参数
 */
export function debugLog(...args) {
  const settings = useWebuiSettingsStore();
  if (settings.options.enableDebugMode) {
    // eslint-disable-next-line no-console
    console.log('[debug]', ...args);
  }
}
