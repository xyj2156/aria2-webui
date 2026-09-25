/**
 * RPC 层内部引擎：不对外，只被同目录的 index.js 使用。
 *
 * 它只知道「协议」，不知道「业务」：管选哪条通道、配置换了要重建连接、
 * 状态与推送怎么分发。方法名到业务语义的翻译集中在 index.js，两层职责不重叠。
 *
 * 上层禁止 import 本文件。
 */

import { RPC_STATUS, WS_RECONNECT_BASE_MS, isWebSocketProtocol } from './constants.js';
import { assertNotMixedContent, normalizeConfig, qualifyMethod } from './payload.js';
import { createHttpTransport } from './transport-http.js';
import { createWsTransport } from './transport-ws.js';

/**
 * 把配置压成一个字符串，用来判断「配置有没有变到必须重建连接」。
 * secret 也算在内：改了密钥必须重连，否则旧连接上的鉴权结果会被继续复用。
 * @param {import('./types.js').RpcConfig} config
 * @returns {string}
 */
function configKey(config) {
  return `${config.protocol}|${config.host}|${config.port}|${config.path}|${config.secret}`;
}

/**
 * @param {Partial<import('./types.js').RpcConfig>} [initialConfig]
 */
export function createRpcEngine(initialConfig = {}) {
  /** @type {import('./types.js').RpcConfig} */
  let config = normalizeConfig(initialConfig);
  /** @type {string} */
  let transportKey = configKey(config);
  /** @type {import('./types.js').RpcTransport|null} */
  let transport = null;
  /** @type {import('./types.js').RpcStatus} */
  let status = RPC_STATUS.IDLE;
  /**
   * WS 自动重连的指数退避「首个间隔基数」（毫秒）；<=0 关闭自动重连。
   * 缓存于此，保证 transport 因配置变化重建后仍沿用上层设定的值；默认取协议常量，
   * 运行期由 setReconnectInterval 从应用层（设置项）注入——rpc 层不 import store。
   */
  let reconnectBaseMs = WS_RECONNECT_BASE_MS;
  /** @type {Set<(status: import('./types.js').RpcStatus) => void>} */
  const statusListeners = new Set();
  /** @type {Map<string, Set<(params: unknown[]) => void>>} 推送方法名 → 处理函数集合 */
  const notificationListeners = new Map();

  /**
   * @param {import('./types.js').RpcStatus} next
   */
  function setStatus(next) {
    if (status === next) {
      return;
    }
    status = next;
    for (const listener of statusListeners) {
      listener(status);
    }
  }

  /**
   * 把 aria2 主动推来的帧转给订阅者。一个订阅者抛错不影响其它订阅者。
   * @param {string} name
   * @param {unknown[]} params
   */
  function dispatchNotification(name, params) {
    const listeners = notificationListeners.get(name);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      try {
        listener(params);
      } catch (error) {
        console.error(`[rpc] 推送 ${name} 的订阅者抛错了`, error);
      }
    }
  }

  /**
   * 按当前配置准备通道；配置变了就拆掉旧的、建新的。
   * @returns {import('./types.js').RpcTransport}
   */
  function ensureTransport() {
    assertNotMixedContent(config);

    const key = configKey(config);
    if (transport && transportKey === key) {
      return transport;
    }

    if (transport) {
      transport.close();
    }
    transportKey = key;

    transport = isWebSocketProtocol(config.protocol)
                ? createWsTransport(() => config, {
        setStatus,
        emitNotification: dispatchNotification,
      })
                : createHttpTransport(() => config, setStatus);

    // 新建通道后补一次当前重连基数（HTTP 无此方法，可选调用即 no-op），
    // 保证配置变化重建 transport 时仍沿用设置里的值。
    transport.setReconnectInterval?.(reconnectBaseMs);

    return transport;
  }

  return {
    /** 当前通道能否收到 aria2 主动推送（只有 ws / wss 能）。 */
    canPush: () => isWebSocketProtocol(config.protocol),

    /**
     * 更新连接配置，只传要改的字段。配置有实质变化时立即断开旧连接，
     * 状态回到 idle，等下一次调用再按需重连。
     * @param {Partial<import('./types.js').RpcConfig>} next
     */
    configure(next) {
      const merged = normalizeConfig({ ...config, ...next });
      const changed = configKey(merged) !== configKey(config);
      config = merged;

      if (changed && transport) {
        transport.close();
        transport = null;
        setStatus(RPC_STATUS.IDLE);
      }
    },

    /**
     * 设置 WS 自动重连的指数退避首个间隔基数（毫秒）；<=0 关闭自动重连。
     * 值缓存在引擎，之后重建的 transport 会沿用；对当前 transport 立即生效。
     * 由应用层从设置项 webSocketReconnectInterval 注入（rpc 层不读 store）。
     * @param {number} ms
     */
    setReconnectInterval(ms) {
      const next = Number(ms);
      reconnectBaseMs = Number.isFinite(next) ? next : WS_RECONNECT_BASE_MS;
      transport?.setReconnectInterval?.(reconnectBaseMs);
    },

    /** @returns {import('./types.js').RpcConfig} 副本，改它不影响引擎内部 */
    getConfig: () => ({ ...config }),

    /** @returns {import('./types.js').RpcStatus} */
    getStatus: () => status,

    /**
     * 发一次 aria2 调用。
     *
     * 连接状态反映的是「能不能跟 aria2 说上话」，不是「这次调用成没成功」：
     * 业务失败（aria2 明确回了 error，例如 gid 不存在）时状态依然是 connected，
     * 那时界面不该显示「未连接」。真正的状态判定在 transport 里做。
     *
     * @param {string} method 写不带前缀的名字即可，例如 'getVersion'
     * @param {unknown[]} [params] 只写业务参数，token 由下层注入
     * @returns {Promise<unknown>}
     */
    invoke(method, params = []) {
      return ensureTransport().call(qualifyMethod(method), params);
    },

    /**
     * 按方法名订阅 aria2 的推送。HTTP 通道永远收不到，调用方先问 canPush()。
     * @param {string} methodName 形如 'aria2.onDownloadStart'
     * @param {(params: unknown[]) => void} listener
     * @returns {() => void} 退订函数
     */
    onNotification(methodName, listener) {
      const name = qualifyMethod(methodName);

      if (!notificationListeners.has(name)) {
        notificationListeners.set(name, new Set());
      }
      notificationListeners.get(name).add(listener);

      return () => {
        const listeners = notificationListeners.get(name);
        if (!listeners) {
          return;
        }
        listeners.delete(listener);
        if (listeners.size === 0) {
          notificationListeners.delete(name);
        }
      };
    },

    /**
     * 订阅连接状态。注册时先回放一次当前值，界面初始化就不必再单独取一次状态。
     * @param {(status: import('./types.js').RpcStatus) => void} listener
     * @returns {() => void} 退订函数
     */
    onStatus(listener) {
      statusListeners.add(listener);
      listener(status);
      return () => statusListeners.delete(listener);
    },
  };
}
