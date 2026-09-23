/**
 * RPC 层的类型契约。本文件只有注释、没有实现，不会被打包进产物。
 *
 * 工程用的是「JS + JSDoc」：把这些 typedef 写在参数/返回值的 @type 上，
 * VSCode / WebStorm 就能给出补全、跳转和类型报错，等于白拿一份类型文档，
 * 又不用给每个文件写 TypeScript 语法。
 */

/**
 * aria2 支持的四种传输协议。https / wss 的 TLS 由浏览器自己完成，我们不碰。
 * @typedef {'http' | 'https' | 'ws' | 'wss'} RpcProtocol
 */

/**
 * 一次连接所需的全部信息，对应「连接设置」表单的字段。
 * @typedef {Object} RpcConfig
 * @property {RpcProtocol} protocol 传输协议；ws / wss 走 WebSocket 通道（有事件推送）
 * @property {string}      host     主机名或 IP，例如 '192.168.6.8'
 * @property {number}      port     端口，aria2 默认 6800
 * @property {string}      path     RPC 路径，不带前导斜杠，aria2 默认 'jsonrpc'
 * @property {string}      secret   RPC 密钥；空串表示 aria2 没设密钥
 */

/**
 * 传输通道（http / ws 两种实现共同遵守的形状）。它只干一件事：
 * 把「调一个 aria2 方法」变成「一个 Promise」。
 * @typedef {Object} RpcTransport
 * @property {'http' | 'ws'} kind            通道类型，用于判断能否拿到事件推送
 * @property {(method: string, params?: unknown[]) => Promise<unknown>} call  发一次调用，成功时 resolve 出
 *   result
 * @property {() => void} close                                               主动关闭；调用后 WS 不再自动重连
 */

/**
 * 客户端向外抛出的连接状态。
 * HTTP 通道没有长连接，connected / error 都由「上一次调用的结果」推断；
 * 只有 WS 通道才会出现 reconnecting。
 * @typedef {'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'} RpcStatus
 */

/**
 * RpcError.kind 的取值，决定了上层该怎么处理这个错误：
 * - transport 连不上 / 连接断了 / HTTP 状态码非 2xx —— 提示用户检查地址与 aria2 是否活着
 * - rpc       aria2 正常回应但业务失败（密钥错、参数错、gid 不存在）—— 直接把 message 显示给用户
 * - timeout   请求发出去了，在期限内没等到响应
 * - parse     拿到了响应但不是合法 JSON / 不是合法 JSON-RPC 包
 * - config    配置本身不可用，例如 https 页面里填了 http 的 aria2
 * @typedef {'transport' | 'rpc' | 'timeout' | 'parse' | 'config'} RpcErrorKind
 */

/**
 * 传给批量调用（system.multicall）的单个子调用。
 * @typedef {Object} RpcBatchCall
 * @property {string}    method  业务方法名，如 'pause'
 * @property {unknown[]} [params] 只写业务参数，token 由本层逐个注入
 */

/**
 * 批量调用的逐项结果。aria2 对失败的子调用不整体报错，而是逐项给错误对象，
 * 所以必须逐条判断。真机（JSON-RPC）实测：成功项是「返回值数组」，
 * 失败项是 { code, message }（同时也兼容 XML-RPC 的 faultCode / faultString 写法）。
 * @typedef {{ ok: true, value: unknown } | { ok: false, error: { code: number|null, message:
 *   string } }} RpcBatchResult
 */

/**
 * aria2 返回的任务状态对象（tellActive / tellStatus 的元素）。
 *
 * 这里刻意保持 aria2 的原始字段名与原始类型，不做任何加工：整数字段
 * （totalLength、downloadSpeed 等）在 JSON-RPC 里是字符串，files / uris
 * 是嵌套结构。把它们换算成界面数据是下一块「任务数据层」的职责，
 * RPC 层只做传输，避免同一件事两处改。
 *
 * @typedef {Record<string, unknown>} Aria2Task
 */

/**
 * aria2 的选项集合（getGlobalOption / changeGlobalOption / getOption 的对象）。
 * 键是 aria2 命令行选项名（去掉前面的 --），值一律是字符串。
 * @typedef {Record<string, string>} Aria2Options
 */

export {};
