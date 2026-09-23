/**
 * HTTP 通道：一次调用 = 一次 fetch，发完即断，没有事件推送。
 *
 * 与旧版 AriaNg 一致的做法：只用浏览器原生 fetch，不引 axios 之类的请求库。
 * 跨域不用我们操心——aria2 的 RPC 响应自带 Access-Control-Allow-Origin: *
 * （真机 aria2 1.37.0 实测），开发服务器直连局域网里的 aria2 是通的。
 */

import { HTTP_TIMEOUT_MS, RPC_STATUS } from './constants.js';
import { RpcError } from './errors.js';
import { buildRequest, buildRpcUrl, unwrapResponse } from './payload.js';

/**
 * @param {() => import('./types.js').RpcConfig} getConfig 每次调用现取配置，切配置不需要重建通道
 * @param {(status: import('./types.js').RpcStatus) => void} setStatus
 * @returns {import('./types.js').RpcTransport}
 */
export function createHttpTransport(getConfig, setStatus) {
  /** @type {Set<AbortController>} 记下在途请求，close() 时一并取消，防止关掉后还回来看见幽灵响应 */
  const inflight = new Set();

  async function call(method, params = []) {
    const config = getConfig();
    const url = buildRpcUrl(config);
    const body = buildRequest(method, params, config.secret);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    inflight.add(controller);
    // 注意：这里不置 connecting。HTTP 没有长连接，每次轮询都翻一次状态会让
    // 顶栏徽标闪个不停；它的状态语义就是「上一次调用的结果」。

    /**
     * 三个 catch 分支分别对应三种「不一样」的失败，用户要做的事也不同：
     * 超时 → 等 aria2 松快一点；网络错误 → 查地址端口；HTTP 非 2xx → 查密钥或反代。
     */
    let response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      setStatus(RPC_STATUS.ERROR);

      if (error?.name === 'AbortError') {
        throw new RpcError(`连接 aria2 超时（${HTTP_TIMEOUT_MS / 1000} 秒）：${url}`, {
          kind: 'timeout',
          method,
          detail: { url },
          cause: error,
        });
      }

      throw new RpcError(`连不上 aria2（${url}）：确认它已启动、端口对、地址没写错`, {
        kind: 'transport',
        method,
        detail: { url },
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      inflight.delete(controller);
    }

    if (!response.ok) {
      setStatus(RPC_STATUS.ERROR);
      const hint = response.status === 401 ? '（401 通常是 RPC 密钥不对）' : '';
      throw new RpcError(`aria2 返回了 HTTP ${response.status} ${response.statusText}${hint}`, {
        kind: 'transport',
        code: response.status,
        method,
        detail: { url },
        secretRejected: response.status === 401,
      });
    }

    let payload;

    try {
      payload = await response.json();
    } catch (error) {
      setStatus(RPC_STATUS.ERROR);
      throw new RpcError('aria2 的响应不是合法 JSON，检查一下地址是不是指到了别的服务上', {
        kind: 'parse',
        method,
        detail: { url },
        cause: error,
      });
    }

    try {
      // HTTP 一发一收，响应天然对得上，所以这里不用管 id 认领
      const result = unwrapResponse(payload, method);
      setStatus(RPC_STATUS.CONNECTED);
      return result;
    } catch (error) {
      // 业务失败（aria2 明确回了 error）说明「话说通了」，连接状态是 connected；
      // 只有报文本身不像 JSON-RPC 响应时，才算通道有问题
      setStatus(error.kind === 'rpc' ? RPC_STATUS.CONNECTED : RPC_STATUS.ERROR);
      throw error;
    }
  }

  function close() {
    for (const controller of inflight) {
      controller.abort();
    }
    inflight.clear();
    setStatus(RPC_STATUS.IDLE);
  }

  return { kind: 'http', call, close };
}
