/**
 * RPC 层的错误模型。
 *
 * 必须先分清两套编号，它们完全不是一回事：
 * 1. JSON-RPC 的 error.code —— 出现在响应体 error 字段里，是「这次调用失败」的原因，
 *    常见值 -1（aria2 的通用业务错误）与 -32xxx（JSON-RPC 规范自身，如 -32601 Method not found）。
 *    它的含义全在 error.message 那句英文里，code 本身没有可读表可查。
 * 2. 任务的 errorCode 字段 —— tellActive / tellStatus 返回的下载项里那个 1~32 的数字，
 *    描述「这个任务为什么失败」，有一套官方固定含义，见本文件末尾的 ARIA2_TASK_ERRORS。
 *
 * 本文件对第 1 类做「翻译成中文人话」，对第 2 类提供码表查询（后面任务块会用到）。
 */

/**
 * 统一的结构化错误。上层只需要看 kind 决定处理方式，看 message 决定说什么。
 *
 * 之所以不用原生 Error 到处抛：原生 Error 只有 message 一个字符串，
 * 「连不上」和「密钥错」在界面上要区别对待（前者引导去设置页改地址，
 * 后者引导改密钥），靠字符串匹配太脆，所以显式带一个 kind。
 */
export class RpcError extends Error {
  /**
   * @param {string} message 面向用户的中文描述
   * @param {Object} [options]
   * @param {import('./types.js').RpcErrorKind} [options.kind]
   * @param {number|string|null} [options.code] 原始错误码（RPC error.code 或任务 errorCode）
   * @param {string} [options.method] 出错时调用的方法名
   * @param {unknown} [options.detail] 原始对象，排查时打印用
   * @param {Error} [options.cause] 原始异常，保留堆栈链
   * @param {boolean} [options.secretRejected] 是否属于「密钥不对/被拒」，界面据此引导去改密钥
   */
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'RpcError';
    /** @type {import('./types.js').RpcErrorKind} */
    this.kind = options.kind || 'rpc';
    this.code = options.code ?? null;
    this.method = options.method || '';
    this.detail = options.detail ?? null;
    this.secretRejected = Boolean(options.secretRejected);
  }
}

/**
 * aria2 没配密钥时，某些版本 / 反代会直接吃掉请求并回 401 + "Unauthorized"，
 * 或者回一个 message 里带 Unauthorized 的 RPC 错误。两种都归到「密钥问题」。
 *
 * 这个正则只允许在 toRpcError 里对「aria2 给的原始英文」用一次。
 * 判定结果必须落到 RpcError.secretRejected 标记上，后续一律读标记——
 * 因为 message 会被换成中文，拿标记之外再去匹配文案必然失效。
 */
const SECRET_REJECTED_PATTERN = /unauthorized|invalid secret|secret/i;

const SECRET_REJECTED_MESSAGE = 'aria2 拒绝了请求：RPC 密钥不正确，或 aria2 设置了密钥而这里留空';

/**
 * 把 aria2 响应体里的 error 对象转成 RpcError。
 * @param {{ code?: number, message?: string, faultString?: string }} rpcError
 * @param {string} [method]
 * @returns {RpcError}
 */
export function toRpcError(rpcError, method = '') {
  const raw = rpcError?.message || rpcError?.faultString || 'aria2 返回了一个没有说明的失败';
  const code = typeof rpcError?.code === 'number' ? rpcError.code : null;
  const rejected = SECRET_REJECTED_PATTERN.test(raw);

  return new RpcError(rejected ? SECRET_REJECTED_MESSAGE : raw, {
    kind: 'rpc',
    code,
    method,
    detail: rpcError,
    secretRejected: rejected,
  });
}

/**
 * 判断一个异常是不是「密钥被拒」，供界面上「跳到连接设置」的按钮使用。
 * @param {unknown} error
 * @returns {boolean}
 */
export function isSecretRejected(error) {
  return error instanceof RpcError && error.secretRejected === true;
}

/**
 * 判断异常是否属于「压根连不上」（供界面提示「请确认 aria2 已启动、地址端口对不对」）。
 * @param {unknown} error
 * @returns {boolean}
 */
export function isUnreachable(error) {
  return error instanceof RpcError && (error.kind === 'transport' || error.kind === 'timeout');
}

/**
 * aria2 任务 errorCode 码表（定义来自 aria2 官方手册）。
 * 0 表示全部成功，7 表示存在未完成的分段，都不是错误，因此不收录。
 *
 * 这里先写中文字面量：工程目前没接 i18n。等接了多语言，
 * 把 value 换成文案键、这一层保留成「码 → 键」即可，调用方不用改。
 */
export const ARIA2_TASK_ERRORS = Object.freeze({
  1: '未知错误',
  2: '操作超时',
  3: '资源未找到',
  4: '资源未找到（--max-file-not-found 触发）',
  5: '下载被中止（--lowest-speed-limit 触发）',
  6: '网络故障',
  8: '不支持断点续传',
  9: '磁盘空间不足',
  10: '分段长度与已下载文件不一致',
  11: '同一时间已有相同下载任务',
  12: '同一时间已有相同种子任务',
  13: '文件已存在',
  14: '文件重命名失败',
  15: '文件打开失败',
  16: '文件创建失败',
  17: '文件读写错误',
  18: '目录创建失败',
  19: '域名解析失败',
  20: 'Metalink 文件解析失败',
  21: 'FTP 命令执行失败',
  22: 'HTTP 响应头异常',
  23: '重定向次数过多',
  24: 'HTTP 认证失败',
  25: 'Bencoded 文件解析失败',
  26: '种子文件损坏',
  27: '磁力链接格式错误',
  28: '选项格式错误',
  29: '服务器负载过高',
  30: '请求体解析失败',
  32: '校验和验证失败',
});

/**
 * 取任务失败原因的可读文案；码不在表里时返回 null，让调用方决定回退到什么。
 * @param {string|number|undefined} errorCode 注意 aria2 的整数字段常以字符串返回，所以这里两种都收
 * @returns {string|null}
 */
export function getTaskErrorMessage(errorCode) {
  if (errorCode === undefined || errorCode === null || errorCode === '' || errorCode === '0' || errorCode === 0) {
    return null;
  }
  const numeric = Number(errorCode);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return ARIA2_TASK_ERRORS[numeric] ?? null;
}
