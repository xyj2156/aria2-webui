/**
 * RPC 层唯一对外入口。界面只用这里导出的函数，不要 import 同目录的其它文件，
 * 更不要在组件里写 fetch / new WebSocket。
 *
 * 出口的筛选标准是「界面上确实有一处要调它」，按界面分组排列；aria2 的原始方法名
 * 写在每句注释里，方便对着 aria2 手册排查。要加新能力时，先在内层加实现，
 * 只有确实需要被界面调用了才在这里加一行出口——内层多出来的东西外面看不见。
 *
 * 用法：
 *   import { getDownloadingTasks, setConnection } from '@/rpc';
 */

import { createRpcEngine } from './client.js';
import {
  LIST_LIMIT,
  METHOD_PREFIX,
  RPC_DOWNLOAD_EVENTS,
  STOPPED_OFFSET,
  WAITING_OFFSET,
} from './constants.js';
import { withToken } from './payload.js';

const engine = createRpcEngine();

/**
 * aria2 结构体里的整数在 JSON-RPC 下是字符串，缺失或异常时按 0 处理，
 * 免得每个界面都要写一遍 Number(x) || 0。
 * @param {unknown} value
 * @returns {number}
 */
function toCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/**
 * @template T
 * @param {unknown} value
 * @returns {T[]}
 */
function toList(value) {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------- 连接与状态

export { RPC_STATUS } from './constants.js';
export { getTaskErrorMessage, isSecretRejected, isUnreachable } from './errors.js';

/**
 * 设置要连哪台 aria2。只传要改的字段，未传的沿用当前值。
 * 地址 / 端口 / 协议 / 密钥任一变化都会立刻断开旧连接，下次调用时按需重连。
 *
 * @param {Partial<import('./types.js').RpcConfig>} config
 * @returns {import('./types.js').RpcConfig} 归一化后的完整配置
 */
export function setConnection(config) {
  engine.configure(config);
  return engine.getConfig();
}

/**
 * 当前连接配置的副本，供「连接设置」表单回填。
 * @returns {import('./types.js').RpcConfig}
 */
export function getConnection() {
  return engine.getConfig();
}

/**
 * 当前连接状态。onConnectionChange 注册时会自动回放一次，所以界面上一般只用订阅，
 * 这个留给不需要响应式的场合（比如导出诊断信息）。
 * @returns {import('./types.js').RpcStatus}
 */
export function getConnectionStatus() {
  return engine.getStatus();
}

/**
 * 订阅连接状态变化（顶栏那个徽标）。
 * @param {(status: import('./types.js').RpcStatus) => void} listener
 * @returns {() => void} 退订函数，组件卸载时必须调用
 */
export function onConnectionChange(listener) {
  return engine.onStatus(listener);
}

/**
 * 能不能收到 aria2 的事件推送。只有 ws / wss 为 true。
 * 为 false 时，需要「完成后自动刷新」的界面必须改成轮询。
 * @returns {boolean}
 */
export function canPushEvents() {
  return engine.canPush();
}

/**
 * 订阅下载事件。回调收到 `{ event, gid }`，event 是去前缀的名字，
 * 取值：onDownloadStart / onDownloadPause / onDownloadStop /
 * onDownloadComplete / onDownloadError / onBtDownloadComplete。
 *
 * 一次注册覆盖全部六种事件（aria2 的六个通知一起订），需要过滤就在回调里判 event。
 *
 * @param {(event: { event: string, gid: string }) => void} listener
 * @returns {() => void} 退订函数
 */
export function onDownloadEvent(listener) {
  const disposers = Object.values(RPC_DOWNLOAD_EVENTS).map((methodName) =>
    engine.onNotification(methodName, (params) => {
      const payload = params[0];
      listener({
        event: methodName.slice(METHOD_PREFIX.length),
        gid: payload && typeof payload === 'object' && 'gid' in payload ? String(payload.gid) : '',
      });
    }),
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

/**
 * 读 aria2 版本与编译特性。也是「连接测试」按钮该调的那个——它不需要任何参数，
 * 通了就说明地址、端口、密钥三件事都对。
 * @returns {Promise<{ version: string, enabledFeatures: string[] }>} aria2.getVersion
 */
export async function getAria2Version() {
  const info = await engine.invoke('getVersion');
  return {
    version: String(info?.version ?? ''),
    enabledFeatures: toList(info?.enabledFeatures),
  };
}

/**
 * 会话标识。aria2 重启后 sessionId 会变、所有旧 gid 作废——
 * 界面缓存的任务列表必须靠它判断该不该整体丢弃。
 * @returns {Promise<{ sessionId: string }>} aria2.getSessionInfo
 */
export async function getAria2Session() {
  const info = await engine.invoke('getSessionInfo');
  return { sessionId: String(info?.sessionId ?? '') };
}

/**
 * 这份 aria2 支持哪些 RPC 方法，用于调试页与能力探测
 * （例如老版本没有 changeUri 时把「换源」按钮藏掉）。
 * @returns {Promise<string[]>} system.listMethods
 */
export async function listSupportedMethods() {
  return toList(await engine.invoke('system.listMethods'));
}

// ---------------------------------------------------------------- 全局统计与全局设置

/**
 * 顶栏要显示的总速度与任务计数。字段已全部转成数字。
 * @returns {Promise<{ downloadSpeed: number, uploadSpeed: number, downloading: number, waiting:
 *   number, stopped: number }>} aria2.getGlobalStat
 */
export async function getGlobalSummary() {
  const stat = await engine.invoke('getGlobalStat');
  return {
    downloadSpeed: toCount(stat?.downloadSpeed),
    uploadSpeed: toCount(stat?.uploadSpeed),
    downloading: toCount(stat?.numActive),
    waiting: toCount(stat?.numWaiting),
    stopped: toCount(stat?.numStopped),
  };
}

/**
 * aria2 全局设置（设置页要渲染的那一大坨）。键是去掉 -- 的选项名，值一律是字符串。
 * @returns {Promise<import('./types.js').Aria2Options>} aria2.getGlobalOption
 */
export async function getAria2Options() {
  const options = await engine.invoke('getGlobalOption');
  return /** @type {import('./types.js').Aria2Options} */ (options && typeof options === 'object' ? options : {});
}

/**
 * 保存全局设置。只传改动过的键即可，aria2 会自动生效（部分选项需要重启）。
 * @param {import('./types.js').Aria2Options} options 改动项
 * @returns {Promise<unknown>} 'OK'
 */
export function saveAria2Options(options) {
  return engine.invoke('changeGlobalOption', [options]);
}

/**
 * 让 aria2 把当前会话（未完成任务的队列）写回 --save-session 指定的文件。
 * 状态页的「保存会话」按钮。不配 save-session 时 aria2 会报错，原样抛给界面即可。
 * @returns {Promise<unknown>}
 */
export function saveAria2Session() {
  return engine.invoke('saveSession');
}

/**
 * 关闭 aria2 进程。aria2 会先把当前分段写完再退，所以可能等一会儿。
 * @returns {Promise<unknown>}
 */
export function shutdownAria2() {
  return engine.invoke('shutdown');
}

// ---------------------------------------------------------------- 任务列表

/**
 * 正在下载的任务（对应 /downloading）。
 * @returns {Promise<import('./types.js').Aria2Task[]>} aria2.tellActive
 */
export async function getDownloadingTasks() {
  return toList(await engine.invoke('tellActive'));
}

/**
 * 排队等待的任务（对应 /waiting）。一次最多取 LIST_LIMIT 条。
 * @returns {Promise<import('./types.js').Aria2Task[]>} aria2.tellWaiting
 */
export async function getWaitingTasks() {
  return toList(await engine.invoke('tellWaiting', [WAITING_OFFSET, LIST_LIMIT]));
}

/**
 * 已停止的任务（对应 /stopped）。注意 aria2 把三类都塞在这个列表里：
 * status 为 paused（暂停）、complete（已完成）、error（出错）、removed（已移除的历史）。
 * 分组交给界面按 status 处理，本层不替界面决定要不要分开取。
 * @returns {Promise<import('./types.js').Aria2Task[]>} aria2.tellStopped
 */
export async function getStoppedTasks() {
  return toList(await engine.invoke('tellStopped', [STOPPED_OFFSET, LIST_LIMIT]));
}

/**
 * 单个任务的状态，任务详情页与列表轮询都用它。
 * @param {string} gid
 * @returns {Promise<import('./types.js').Aria2Task>} aria2.tellStatus
 */
export function getTask(gid) {
  return /** @type {Promise<import('./types.js').Aria2Task>} */ (engine.invoke('tellStatus', [gid]));
}

// ---------------------------------------------------------------- 任务详情子数据

/**
 * 任务内文件清单（详情页文件 tab；含 path / length / completedLength / supportedScheme 等）。
 * @param {string} gid
 * @returns {Promise<Record<string, unknown>[]>} aria2.getFiles
 */
export function getTaskFiles(gid) {
  return engine.invoke('getFiles', [gid]).then(toList);
}

/**
 * 该任务所有文件的下载源清单（文件 tab 里每个文件的 uri 列表）。
 * @param {string} gid
 * @returns {Promise<Record<string, unknown>[]>} aria2.getUris
 */
export function getTaskUris(gid) {
  return engine.invoke('getUris', [gid]).then(toList);
}

/**
 * BT 任务的邻居（详情页 btpeers tab）。非 BT 任务会报错，调用方先判 protocol。
 * @param {string} gid
 * @returns {Promise<Record<string, unknown>[]>} aria2.getPeers
 */
export function getTaskPeers(gid) {
  return engine.invoke('getPeers', [gid]).then(toList);
}

/**
 * FTP 任务的服务器列表（详情页用，非 FTP 任务返回空）。
 * @param {string} gid
 * @returns {Promise<Record<string, unknown>[]>} aria2.getServers
 */
export function getTaskServers(gid) {
  return engine.invoke('getServers', [gid]).then(toList);
}

/**
 * 单个任务当前生效的选项（详情页 settings tab）。
 * @param {string} gid
 * @returns {Promise<import('./types.js').Aria2Options>} aria2.getOption
 */
export function getTaskOptions(gid) {
  return /** @type {Promise<import('./types.js').Aria2Options>} */ (engine.invoke('getOption', [gid]));
}

/**
 * 改单个任务的选项（详情页里改 out / dir / max-connection-per-server 等）。
 * @param {string} gid
 * @param {import('./types.js').Aria2Options} options 只传改动项
 * @returns {Promise<unknown>} 'OK'
 */
export function saveTaskOptions(gid, options) {
  return engine.invoke('changeOption', [gid, options]);
}

// ---------------------------------------------------------------- 任务写操作

/**
 * 新建普通下载任务。urls 是「同一个文件的多个镜像源」，不是多个文件——
 * 这是 aria2 的语义，界面上每个输入行对应一次本调用。
 * @param {string[]} urls 至少一个
 * @param {import('./types.js').Aria2Options} [options] 例如 { dir, out, split }
 * @returns {Promise<string>} 新任务的 gid aria2.addUri
 */
export function addTask(urls, options) {
  return /** @type {Promise<string>} */ (
    engine.invoke('addUri', options ? [urls, options] : [urls])
  );
}

/**
 * 新建种子任务。
 * @param {string} content 种子文件内容的 base64（用 FileReader 读出来后自己转，别引库）
 * @param {string[]} [uris] 附加的下载源，一般留空
 * @param {import('./types.js').Aria2Options} [options]
 * @returns {Promise<string>} gid aria2.addTorrent
 */
export function addTorrentTask(content, uris = [], options) {
  return /** @type {Promise<string>} */ (
    engine.invoke('addTorrent', options ? [content, uris, options] : [content, uris])
  );
}

/**
 * 新建 Metalink 任务。一个 metalink 可以描述多个文件，所以返回的是 gid 数组。
 * @param {string} content metalink 文件内容的 base64
 * @param {string[]} [uris]
 * @param {import('./types.js').Aria2Options} [options]
 * @returns {Promise<string[]>} gid 列表 aria2.addMetalink
 */
export async function addMetalinkTask(content, uris = [], options) {
  const gids = await engine.invoke('addMetalink', options ? [content, uris, options] : [content,
                                                                                        uris]);
  return toList(gids);
}

/**
 * 暂停。aria2 会先把正在传的分段落盘，稍后才变 paused。
 * @param {string} gid
 * @returns {Promise<unknown>} 'OK'
 */
export function pauseTask(gid) {
  return engine.invoke('pause', [gid]);
}

/**
 * 立刻暂停，不等当前分段传完。界面上的「停止」按钮该用这个，反馈才干脆。
 * @param {string} gid
 * @returns {Promise<unknown>} 'OK'
 */
export function pauseTaskNow(gid) {
  return engine.invoke('forcePause', [gid]);
}

/**
 * 继续（重新排进等待队列，等空闲槽位）。
 * @param {string} gid
 * @returns {Promise<unknown>} 'OK'
 */
export function resumeTask(gid) {
  return engine.invoke('unpause', [gid]);
}

/**
 * 移除任务。下载中会先停下再移除，磁盘上已下载的文件保留。
 * @param {string} gid
 * @returns {Promise<unknown>} 'OK'
 */
export function removeTask(gid) {
  return engine.invoke('remove', [gid]);
}

/**
 * 立刻移除，不等当前分段。列表页多选批量删除时用这个，避免逐个等待。
 * @param {string} gid
 * @returns {Promise<unknown>} 'OK'
 */
export function removeTaskNow(gid) {
  return engine.invoke('forceRemove', [gid]);
}

/**
 * 从「已停止」列表里抹掉某一条历史记录（不影响磁盘文件）。
 * @param {string} gid
 * @returns {Promise<unknown>} 'OK'
 */
export function forgetTaskResult(gid) {
  return engine.invoke('removeDownloadResult', [gid]);
}

/**
 * 清空已完成 / 已移除的历史记录。列表页「清除已完成」按钮。
 * @returns {Promise<unknown>} 'OK'
 */
export function clearFinishedResults() {
  return engine.invoke('purgeDownloadResult');
}

/**
 * 全部暂停。aria2 提供两档，这里默认温和档，需要立刻停就传 now。
 * @param {{ now?: boolean }} [flags]
 * @returns {Promise<unknown>} 'OK'
 */
export function pauseAllTasks(flags = {}) {
  return engine.invoke(flags.now ? 'forcePauseAll' : 'pauseAll');
}

/**
 * 继续全部被暂停的任务。
 * @returns {Promise<unknown>} 'OK'
 */
export function resumeAllTasks() {
  return engine.invoke('unpauseAll');
}

/**
 * 在等待队列里移动任务（列表页的上移 / 下移 / 置顶 / 置底）。
 * @param {string} gid
 * @param {number} offset 位移量
 * @param {'POS_SET'|'POS_CUR'|'POS_END'} [reference] aria2 手册的三个取值（how）：
 *   POS_SET 相对队首算绝对位（offset 0 = 置顶，越界自动夹到区间内）；POS_CUR 相对当前位置移动
 *   （offset 可为负）；POS_END 相对队尾。示例：置顶 (0, 'POS_SET')、下移一位 (1, 'POS_CUR')、
 *   置底 (0, 'POS_END')。返回移动后的新位置。
 * @returns {Promise<number>} 移动后的新位置 aria2.changePosition
 */
export async function moveTask(gid, offset, reference = 'POS_SET') {
  const position = await engine.invoke('changePosition', [gid, offset, reference]);
  return toCount(position);
}

/**
 * 替换某个文件的下载源（详情页文件 tab 的「编辑源」）。
 * @param {string} gid
 * @param {number} fileIndex 文件序号，从 0 开始
 * @param {string[]} removeUris 要删掉的源
 * @param {string[]} addUris 要加的源
 * @param {number} [position] 新源插入位置；不传就追加到末尾（aria2 手册里这个参数是整数）
 * @returns {Promise<{ removed: number, added: number }>} aria2.changeUri
 */
export async function replaceTaskSources(gid, fileIndex, removeUris, addUris, position) {
  const params = position === undefined ? [gid, fileIndex, removeUris, addUris] : [gid, fileIndex,
                                                                                   removeUris,
                                                                                   addUris,
                                                                                   position];
  const result = await engine.invoke('changeUri', params);
  const [removed, added] = toList(result);
  return { removed: toCount(removed), added: toCount(added) };
}

// ---------------------------------------------------------------- 批量

/**
 * 一次往返发多个调用，列表页批量操作（多选暂停 / 删除 / 重试）用它。
 *
 * aria2 的规矩：子调用只能是 aria2.* 业务方法，且每个子调用各自带 token；
 * 顶层 system.multicall 自己不带 token（这条已由 buildRequest 统一处理）。
 * 某个子调用失败不会让整批失败，结果逐项给，所以要检查每一条的 ok。
 *
 * @param {import('./types.js').RpcBatchCall[]} calls
 * @returns {Promise<import('./types.js').RpcBatchResult[]>}
 */
export async function invokeBatch(calls) {
  if (!Array.isArray(calls) || calls.length === 0) {
    return [];
  }

  const { secret } = engine.getConfig();
  const payloads = calls.map((item) => ({
    methodName: item.method.startsWith(METHOD_PREFIX) ? item.method : `${METHOD_PREFIX}${item.method}`,
    params: withToken(secret, item.params || []),
  }));

  const rows = toList(await engine.invoke('system.multicall', [payloads]));

  return rows.map((row) => {
    // 成功：aria2 给的是返回值数组，取第一个；失败：给 {code, message}（兼容 faultCode/faultString）
    if (Array.isArray(row)) {
      return { ok: true, value: row[0] };
    }

    const record = /** @type {Record<string, unknown>} */ (row && typeof row === 'object' ? row : {});
    const message = record.message || record.faultString;

    if (typeof message === 'string') {
      const code = Number(record.code ?? record.faultCode);
      return { ok: false, error: { code: Number.isFinite(code) ? code : null, message } };
    }

    return { ok: false, error: { code: null, message: 'aria2 返回了无法识别的批量调用结果' } };
  });
}
