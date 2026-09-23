/**
 * aria2 JSON-RPC 协议层的常量。
 * 这里只放「协议事实」和「默认值」，不放业务逻辑。
 */

/** JSON-RPC 规范里必须回填的版本号，aria2 校验这个字段。 */
export const JSONRPC_VERSION = '2.0';

/** 业务方法前缀，例如 aria2.getVersion。 */
export const METHOD_PREFIX = 'aria2.';

/** 协议层方法前缀，system.multicall / system.listMethods 走这个。 */
export const SYSTEM_PREFIX = 'system.';

/** 密钥在 params 数组里的固定写法前缀。 */
export const TOKEN_PREFIX = 'token:';

/** aria2 默认的 RPC 监听路径（不带前导斜杠）。 */
export const DEFAULT_RPC_PATH = 'jsonrpc';

/** aria2 默认监听端口。 */
export const DEFAULT_RPC_PORT = 6800;

/** HTTP 单次请求的超时（毫秒）。aria2 卡住时不至于让界面永远转圈。 */
export const HTTP_TIMEOUT_MS = 20000;

/** WS 单次调用的响应超时（毫秒）。连接是通的，但要防止某个请求石沉大海。 */
export const WS_CALL_TIMEOUT_MS = 20000;

/** WS 断线重连的起始间隔（毫秒），每次翻倍。 */
export const WS_RECONNECT_BASE_MS = 1000;

/** WS 重连间隔的上限（毫秒），避免指数增长到几十分钟。 */
export const WS_RECONNECT_MAX_MS = 30000;

/** 连接状态枚举，值会直接用于界面徽标的文案键。 */
export const RPC_STATUS = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  ERROR: 'error',
});

/**
 * aria2 的六个下载事件。只有 WebSocket 通道会推送，HTTP 通道永远收不到，
 * 依赖事件的功能（完成通知、列表自动刷新）在 HTTP 下必须降级成轮询。
 */
export const RPC_DOWNLOAD_EVENTS = Object.freeze({
  onStart: 'aria2.onDownloadStart',
  onPause: 'aria2.onDownloadPause',
  onStop: 'aria2.onDownloadStop',
  onComplete: 'aria2.onDownloadComplete',
  onError: 'aria2.onDownloadError',
  onBtComplete: 'aria2.onBtDownloadComplete',
});

/**
 * tellWaiting / tellStopped 的分页参数。
 * 这组默认值取自上一版真机（群晖 aria2 1.37.0）跑通的组合：
 * waiting 从队首取，stopped 用 offset -1 表示「从队尾往前数」——
 * aria2 的 stopped 队列是个有限环形表，用 0 取法拿不到最近的记录。
 */
export const WAITING_OFFSET = 0;
export const STOPPED_OFFSET = -1;
export const LIST_LIMIT = 1000;

/**
 * 判断是否走 WebSocket 通道。
 * @param {string} protocol
 * @returns {boolean}
 */
export function isWebSocketProtocol(protocol) {
  return protocol === 'ws' || protocol === 'wss';
}
