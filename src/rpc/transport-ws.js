/**
 * WebSocket 通道：一条长连接复用给所有请求。
 *
 * 与 HTTP 通道的三点本质差异，本文件的复杂度全部来自这里：
 * 1. 并发：多个请求先后写进同一条 socket，响应回来的顺序不保证，
 *    必须靠请求里的 id 建一张「id → 待完成的 Promise」的表来认领。
 * 2. 推送：aria2 会主动发没有 id、只有 method 的帧（onDownloadStart 等六种），
 *    这些不属于任何请求，要分发给订阅者。
 * 3. 断线：对端重启、网络抖一下都会静默断开，得自动重连，
 *    并且重连不能无限快循环（指数退避）。
 */

import {
  RPC_STATUS,
  WS_CALL_TIMEOUT_MS,
  WS_RECONNECT_BASE_MS,
  WS_RECONNECT_MAX_MS,
} from './constants.js';
import { RpcError } from './errors.js';
import { buildRequest, buildRpcUrl, unwrapResponse } from './payload.js';

/**
 * @param {() => import('./types.js').RpcConfig} getConfig
 * @param {Object} handlers
 * @param {(status: import('./types.js').RpcStatus) => void} handlers.setStatus 状态变化回调
 * @param {(method: string, params: unknown[]) => void} handlers.emitNotification 收到推送帧时的出口
 * @returns {import('./types.js').RpcTransport}
 */
export function createWsTransport(getConfig, handlers) {
  const { setStatus, emitNotification } = handlers;

  /** @type {WebSocket|null} 当前这条连接 */
  let activeSocket = null;
  /** @type {Promise<WebSocket>|null} 正在建连时共享的 Promise，避免同一时刻开出两条连接 */
  let connectPromise = null;
  /** @type {((reason: Error) => void)|null} 建连还没成功就被掐断时，用它把等待者叫醒 */
  let connectReject = null;
  /** @type {Map<string, { resolve: Function, reject: Function, method: string, timeout: ReturnType<typeof setTimeout> }>} */
  const pending = new Map();
  /** @type {ReturnType<typeof setTimeout>|null} */
  let reconnectTimer = null;
  /** 已经重连到第几轮，决定本次等待多久；连上后归零 */
  let attempt = 0;
  /**
   * 自动重连指数退避的「首个间隔基数」（毫秒）；<=0 关闭自动重连。
   * 默认取协议常量，运行期由 setReconnectInterval 用设置项 webSocketReconnectInterval 覆盖。
   */
  let reconnectBaseMs = WS_RECONNECT_BASE_MS;
  /** 本端调过 close() 后不再自动重连。切换连接配置时 client 会新建一个通道，所以不必复位 */
  let disposed = false;

  /** 摘掉 socket 上所有回调：用于丢弃一条已经报废的连接，免得它的迟到事件干扰新连接 */
  function clearSocketHandlers(socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  }

  /** 把还在等的请求全部按失败处理，否则调用方的 Promise 会永远挂着 */
  function failAllPending(error) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
    pending.clear();
  }

  /**
   * 建立（或复用）一条连接。
   * @returns {Promise<WebSocket>}
   */
  function open() {
    if (disposed) {
      return Promise.reject(new RpcError('该 RPC 通道已关闭', { kind: 'transport' }));
    }
    if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
      return Promise.resolve(activeSocket);
    }
    if (connectPromise) {
      return connectPromise;
    }

    const config = getConfig();
    const url = buildRpcUrl(config);
    let socket;

    try {
      // aria2 走的是文本帧，不需要设置 binaryType
      socket = new WebSocket(url);
    } catch (error) {
      setStatus(RPC_STATUS.ERROR);
      return Promise.reject(
        new RpcError(`WebSocket 地址不合法：${url}`, {
          kind: 'config',
          detail: { url },
          cause: error,
        }),
      );
    }

    activeSocket = socket;
    setStatus(attempt === 0 ? RPC_STATUS.CONNECTING : RPC_STATUS.RECONNECTING);

    connectPromise = new Promise((resolve, reject) => {
      connectReject = reject;

      socket.onopen = () => {
        attempt = 0;
        connectReject = null;
        connectPromise = null;
        setStatus(RPC_STATUS.CONNECTED);
        resolve(socket);
      };

      socket.onmessage = (event) => handleFrame(event.data);

      // 浏览器出于安全考虑不在 onerror 里给出任何失败细节，真正的原因只能在 onclose 里推断
      socket.onerror = () => {
      };

      socket.onclose = (event) => handleClose(socket, event);
    });

    return connectPromise;
  }

  /**
   * @param {WebSocket} socket 触发关闭的那条连接，可能是已经被换掉的旧连接
   * @param {CloseEvent} event
   */
  function handleClose(socket, event) {
    const isCurrent = activeSocket === socket;
    clearSocketHandlers(socket);

    const waiter = connectReject;
    if (isCurrent) {
      activeSocket = null;
      connectPromise = null;
      connectReject = null;
    }

    const reason = event.reason ? `关闭：${event.reason}` : `已断开（code ${event.code}）`;
    failAllPending(new RpcError(`与 aria2 的 WebSocket ${reason}`, {
      kind: 'transport',
      detail: { url: socket.url },
    }));

    // 旧连接的迟到事件、或本端主动关闭，都不该触发重连
    if (!isCurrent || disposed) {
      return;
    }

    if (waiter) {
      waiter(new RpcError(`连不上 aria2 的 WebSocket，正在后台重试`, { kind: 'transport' }));
    }
    scheduleReconnect();
  }

  function scheduleReconnect() {
    if (reconnectTimer !== null) {
      return;
    }

    // 基数 <=0 = 关闭自动重连（设置项 webSocketReconnectInterval 的语义）：不再排下一轮，
    // 状态标为 error 让顶栏显示「连接异常」，等用户主动重试（再次调用 / 切换连接）。
    if (reconnectBaseMs <= 0) {
      setStatus(RPC_STATUS.ERROR);
      return;
    }

    const delay = Math.min(reconnectBaseMs * 2 ** attempt, WS_RECONNECT_MAX_MS);
    attempt += 1;
    setStatus(RPC_STATUS.RECONNECTING);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      // open() 失败会在 onclose 里再排下一轮，这里吞掉 rejection 只为避免「未处理的 Promise 拒绝」
      open().catch(() => {
      });
    }, delay);
  }

  /** 解析一帧收到的数据，分流成「响应」和「推送」 */
  function handleFrame(raw) {
    let payload;

    try {
      payload = JSON.parse(String(raw));
    } catch (error) {
      console.warn('[rpc/ws] 收到无法解析的帧，已忽略', raw, error);
      return;
    }

    const id = payload?.id;

    if (id !== undefined && id !== null && pending.has(String(id))) {
      const key = String(id);
      const entry = pending.get(key);
      pending.delete(key);
      clearTimeout(entry.timeout);

      try {
        entry.resolve(unwrapResponse(payload, entry.method));
      } catch (error) {
        entry.reject(error);
      }
      return;
    }

    if (typeof payload?.method === 'string') {
      emitNotification(payload.method, Array.isArray(payload.params) ? payload.params : []);
      return;
    }

    console.warn('[rpc/ws] 收到一个既不对应请求、也不是推送的帧，已忽略', payload);
  }

  async function call(method, params = []) {
    const config = getConfig();
    const body = buildRequest(method, params, config.secret);
    const socket = await open();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(body.id);
        reject(
          new RpcError(`aria2 在 ${WS_CALL_TIMEOUT_MS / 1000} 秒内没有回应 ${body.method}`, {
            kind: 'timeout',
            method: body.method,
          }),
        );
      }, WS_CALL_TIMEOUT_MS);

      // 先登记再发送：万一对端秒回，也不会出现「响应回来时表里还没有这一条」
      pending.set(body.id, { resolve, reject, method: body.method, timeout });

      try {
        socket.send(JSON.stringify(body));
      } catch (error) {
        clearTimeout(timeout);
        pending.delete(body.id);
        reject(
          new RpcError('WebSocket 发送失败，连接大概刚刚断开了', {
            kind: 'transport',
            method: body.method,
            cause: error,
          }),
        );
      }
    });
  }

  function close() {
    disposed = true;

    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    attempt = 0;

    const socket = activeSocket;
    const waiter = connectReject;
    activeSocket = null;
    connectPromise = null;
    connectReject = null;

    if (socket) {
      clearSocketHandlers(socket);
      // close() 只接受 1000 或 3000~4999；传 1001、1005 这类握手状态码会抛 InvalidAccessError
      try {
        socket.close(1000);
      } catch {
        // 已经关了，无所谓
      }
    }

    const error = new RpcError('连接已由本端主动关闭', { kind: 'transport' });
    failAllPending(error);
    waiter?.(error);
    setStatus(RPC_STATUS.IDLE);
  }

  /**
   * 运行期调整自动重连的指数退避首个间隔基数（毫秒）。值来自设置项 webSocketReconnectInterval，
   * 由引擎转发进来（rpc 层不 import store）。<=0 关闭自动重连，并立即撤掉已排定的重连；
   * 新的正数在下一次断线排程时生效。
   * @param {number} ms
   */
  function setReconnectInterval(ms) {
    const next = Number(ms);
    reconnectBaseMs = Number.isFinite(next) ? next : 0;
    if (reconnectBaseMs <= 0 && reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  return { kind: 'ws', call, close, setReconnectInterval };
}