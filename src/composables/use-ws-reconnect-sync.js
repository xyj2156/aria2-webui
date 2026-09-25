/**
 * 把全局设置 webSocketReconnectInterval 同步给 RPC 引擎。
 *
 * 语义（对齐 aria-ng）：该值是 WS 断线重连指数退避的「首个间隔基数」（毫秒），
 * 之后每次翻倍、封顶 WS_RECONNECT_MAX_MS；0 = 关闭自动重连。
 *
 * 分层：store 是单一事实源，rpc 层不 import store——值经这里 watch 后用 rpc 暴露的
 * setWsReconnectInterval 推入引擎（引擎缓存 + 转发给当前/未来 transport）。
 * 与 use-theme-sync / use-language-sync 同款：启动即同步一次，之后改设置即时生效。
 */
import { watch } from 'vue';

import { setWsReconnectInterval } from '@/rpc';
import { useWebuiSettingsStore } from '@/store/webui-settings.js';

export function useWsReconnectSync() {
  const settings = useWebuiSettingsStore();

  const apply = () => setWsReconnectInterval(Number(settings.options.webSocketReconnectInterval) || 0);

  // 启动即同步：此刻 transport 可能还没建，引擎会缓存该值，建 WS 通道时自动应用。
  apply();
  watch(() => settings.options.webSocketReconnectInterval, apply);
}
