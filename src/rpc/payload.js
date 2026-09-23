/**
 * JSON-RPC 报文的组装与拆解。本文件全部是纯函数：
 * 不碰 fetch、不碰 WebSocket、不碰 localStorage，所以可以直接在 Node 里跑单测，
 * 也可以在浏览器控制台里单独验「拼出来的报文长什么样」。
 */

import {
  DEFAULT_RPC_PATH,
  DEFAULT_RPC_PORT,
  JSONRPC_VERSION,
  METHOD_PREFIX,
  SYSTEM_PREFIX,
  TOKEN_PREFIX,
  isWebSocketProtocol,
} from './constants.js';
import { RpcError, toRpcError } from './errors.js';

/**
 * 请求 id 计数器。id 的作用只有一个：WebSocket 通道上多条请求并发飞出去、
 * 响应回来的顺序不固定，要靠 id 把响应认领回对应的 Promise。
 * 因此只要在本页面生命周期内不重复就够了，不必全局唯一。
 */
let idSequence = 0;

/**
 * @returns {string} 下一个请求 id
 */
export function nextRequestId() {
  idSequence += 1;
  return String(idSequence);
}

/**
 * 补齐并校验用户填的连接配置，产出一个字段齐全的对象。
 * 界面上的输入框可能给空串、字符串端口、带斜杠的路径，统一在这里收拾干净，
 * 后面所有代码都可以假设拿到的是一个规整的 RpcConfig。
 *
 * @param {Partial<import('./types.js').RpcConfig>} [input]
 * @returns {import('./types.js').RpcConfig}
 */
export function normalizeConfig(input = {}) {
  const protocol = input.protocol || 'http';
  const host = (input.host || 'localhost').trim();
  const port = Number(input.port) > 0 ? Number(input.port) : DEFAULT_RPC_PORT;
  // 路径两边的斜杠都剥掉，交给 buildRpcUrl 统一加，避免出现 //jsonrpc 这种拼接事故
  const path = (input.path || DEFAULT_RPC_PATH).replace(/^\/+|\/+$/g, '') || DEFAULT_RPC_PATH;
  const secret = (input.secret || '').trim();

  return { protocol, host, port, path, secret };
}

/**
 * 拼出实际请求地址：{protocol}://{host}:{port}/{path}
 * @param {Partial<import('./types.js').RpcConfig>} config 已经过 normalizeConfig 的对象
 * @returns {string}
 */
export function buildRpcUrl(config) {
  return `${config.protocol}://${config.host}:${config.port}/${config.path}`;
}

/**
 * 给方法名补上 'aria2.' 前缀。
 * 写成 'aria2.getVersion'、'getVersion'、'system.multicall' 三种都接受，
 * 但 system.* 绝不能被加成 'aria2.system.multicall'。
 *
 * @param {string} method
 * @returns {string}
 */
export function qualifyMethod(method) {
  const name = String(method).trim();
  if (name.startsWith(METHOD_PREFIX) || name.startsWith(SYSTEM_PREFIX)) {
    return name;
  }
  return name.includes('.') ? name : `${METHOD_PREFIX}${name}`;
}

/**
 * 把密钥按 aria2 的写法插到参数列表最前面。
 *
 * aria2 的两条硬规矩：
 * 1. 设了 RPC 密钥时，密钥必须作为 params 的第一个元素，写法是 'token:xxx'；
 * 2. 没设密钥时不能塞这个元素，否则 aria2 会把它当成业务参数、报参数个数错误。
 *
 * system.multicall 的每个子调用也要求各自带 token，所以这个函数单独导出。
 *
 * @param {string} secret
 * @param {unknown[]} [params]
 * @returns {unknown[]} 新数组，不修改入参
 */
export function withToken(secret, params = []) {
  const finalParams = Array.isArray(params) ? [...params] : [params];

  if (secret) {
    finalParams.unshift(`${TOKEN_PREFIX}${secret}`);
  }

  return finalParams;
}

/**
 * system.* 是 JSON-RPC 规范自身的方法，不是 aria2 的业务方法，不接受 token 参数。
 * 给它们插 token 会被当成多余参数（真机验证过的上一版就是按这条规则排除的）。
 * @param {string} qualifiedMethod 已补前缀的方法名
 * @returns {boolean}
 */
export function isSystemMethod(qualifiedMethod) {
  return qualifiedMethod.startsWith(SYSTEM_PREFIX);
}

/**
 * 组装一次完整的 JSON-RPC 请求体。密钥只对 aria2.* 注入，system.* 一律不带。
 *
 * @param {string} method 不带前缀也行
 * @param {unknown[]} [params] 业务参数
 * @param {string} [secret]
 * @returns {{ jsonrpc: string, id: string, method: string, params: unknown[] }}
 */
export function buildRequest(method, params = [], secret = '') {
  const name = qualifyMethod(method);

  return {
    jsonrpc: JSONRPC_VERSION,
    id: nextRequestId(),
    method: name,
    params: withToken(isSystemMethod(name) ? '' : secret, params),
  };
}

/**
 * 拆解并判定一次响应。
 *
 * 关键事实：aria2 业务失败时 HTTP 状态码依然是 200，错误藏在响应体的 error 字段里。
 * 所以「response.ok」只能证明网络通了，绝不能拿来当调用成功的依据。
 *
 * @param {unknown} payload 已 JSON.parse 的响应体
 * @param {string} method 本次调用的方法名，只用于错误信息
 * @returns {unknown} 成功时返回 result
 * @throws {RpcError} 业务失败 / 响应体不是合法 JSON-RPC 包
 */
export function unwrapResponse(payload, method = '') {
  if (!payload || typeof payload !== 'object') {
    throw new RpcError('aria2 返回的内容不是一个 JSON 对象', {
      kind: 'parse',
      method,
      detail: payload,
    });
  }

  const body = /** @type {{ error?: { code?: number, message?: string }, result?: unknown }} */ (payload);

  if (body.error) {
    throw toRpcError(body.error, method);
  }

  return body.result;
}

/**
 * 页面运行在 https 时，浏览器会拦掉对 http / ws 的混合内容请求，
 * 而且拦截发生在网络层，报错信息很难看懂。这里提前挡住，给一句能照着做的提示。
 *
 * 只在浏览器环境生效；Node 脚本里 location 不存在，直接放过，方便离线验证。
 *
 * @param {import('./types.js').RpcConfig} config
 * @param {unknown} globalScope 注入以便测试，默认取全局 window
 * @throws {RpcError} 配置不可用时
 */
export function assertNotMixedContent(config, globalScope = globalThis) {
  const pageProtocol = globalScope?.location?.protocol;
  const pageIsSecure = pageProtocol === 'https:';
  const aria2IsSecure = config.protocol === 'https' || config.protocol === 'wss';

  if (pageIsSecure && !aria2IsSecure) {
    const ws = isWebSocketProtocol(config.protocol);
    throw new RpcError(
      `当前页面是 https，不能连接 ${config.protocol}:// 的 aria2（浏览器会以「混合内容」为由拦截）。` +
      `把 aria2 的 RPC 也换成 ${ws ? 'wss' : 'https'}，或让页面走 http。`,
      { kind: 'config', code: null, method: '' },
    );
  }
}
