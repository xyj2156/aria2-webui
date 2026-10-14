/**
 * HTTP 通道：一次调用 = 一次 fetch，发完即断，没有事件推送。
 *
 * 与旧版 AriaNg 一致的做法：只用浏览器原生 fetch，不引 axios 之类的请求库。
 * 跨域不用我们操心——aria2 的 RPC 响应自带 Access-Control-Allow-Origin: *
 * （真机 aria2 1.37.0 实测），开发服务器直连局域网里的 aria2 是通的。
 */

import { HTTP_TIMEOUT_MS, RPC_STATUS } from './constants.js';
import { RpcError, toRpcError } from './errors.js';
import { buildRequest, buildRpcUrl, unwrapResponse } from './payload.js';

/** 值得在文案里提一句「可能是密钥」的状态码；400 是 aria2 实际用的那个，401/403 是各类反代用的 */
const AUTH_LIKE_STATUS = new Set([400, 401, 403]);

/**
 * 非 2xx 时也先把响应体读出来：拒绝原因在体里，状态码给不出。
 * 读不动（空体、非 JSON、流被消耗）就返回 null，由调用方退回状态码文案。
 * @param {Response} response
 * @returns {Promise<any>}
 */
async function readJsonBody(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

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

      // 实测事实（真机 aria2 1.37.0）：没填密钥、或密钥不对时，aria2 回的是 **HTTP 400**，
      // 原因写在响应体的 JSON-RPC error 里（message: "Unauthorized"），并不是 401。所以
      // 光看状态码永远说不出「这是密钥问题」，「密钥不正确」的引导也就从来没触发过。
      // 这里先按 JSON-RPC 解一次响应体：解得出原因就照原因报（交给 toRpcError 归成
      // secretRejected，界面据此引导去改密钥）；解不出（反代截成 HTML、空体、限流页）
      // 才退回状态码文案。
      const payload = await readJsonBody(response);

      if (payload && typeof payload === 'object' && payload.error) {
        const mapped = toRpcError(payload.error, method);

        // kind 用 rpc：aria2 好好答话了，只是不接受这次鉴权。徽标仍置 error，因为
        // 「连得上但用不了」在用户眼里就是没连上。
        throw new RpcError(mapped.message, {
          kind: 'rpc',
          code: mapped.code ?? response.status,
          method,
          detail: { url, httpStatus: response.status, rpcError: payload.error },
          secretRejected: mapped.secretRejected,
        });
      }

      const hint = AUTH_LIKE_STATUS.has(response.status) ? '（这个状态通常是 RPC 密钥没填或填错）' : '';

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
