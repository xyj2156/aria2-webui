/**
 * 任务「重试」。
 *
 * aria2 没有原生的 retry，重试 = 用任务原来的 URIs + 原来（且 add 合法）的选项，
 * 再走一次 addUri 重新下单。只对「来源可重建」的任务可靠：
 *   - HTTP / FTP 直链：getUris 拿得到原始链接；
 *   - 磁链（magnet:?...）：也是 uri，可原样 addUri。
 * 而 .torrent / metalink 文件内容 aria2 不留存、RPC 取不回，这类没有任何可重建 uri，
 * 判定为不可重试（返回 not-retryable），由调用方提示用户重新添加。
 *
 * 选项只回灌新建对话框也允许的那批键（getNewTaskOptionKeys），保证都是 addUri 合法项，
 * 不把 getOption 返回的全量（含派生/只读项）原样塞回去导致 addUri 报错。
 */
import { addTask, forgetTaskResult, getTaskOptions, getTaskUris } from '@/rpc';
import { getNewTaskOptionKeys } from '@/services/option-service.js';

/** 可重建的 uri 协议白名单：http/https/ftp 直链 + magnet 磁链。 */
const RE_ADDABLE_URI = /^(https?|ftp|magnet):/i;

/** 重试允许回灌的选项键 = 新建任务（含 BT）用到的那批 add 合法键。 */
const RETRY_OPTION_KEYS = getNewTaskOptionKeys(true);

/**
 * 取某任务的可重建 URIs 与重建选项。不实际下单，供上层判定可见性 / 组装。
 * @param {string} gid
 * @returns {Promise<
 *   | { ok: true, uris: string[], options: Record<string,string> }
 *   | { ok: false, reason: 'not-retryable' }
 * >}
 */
export async function buildRetryPayload(gid) {
  const uriRows = await getTaskUris(gid);
  const uris = (Array.isArray(uriRows) ? uriRows : [])
    .map((row) => row?.uri)
    .filter((uri) => typeof uri === 'string' && RE_ADDABLE_URI.test(uri));

  if (uris.length === 0) {
    return { ok: false, reason: 'not-retryable' };
  }

  const current = await getTaskOptions(gid);
  const options = {};
  for (const key of RETRY_OPTION_KEYS) {
    const value = current?.[key];
    if (value !== undefined && value !== null && value !== '') {
      options[key] = String(value);
    }
  }
  return { ok: true, uris, options };
}

/**
 * 重试一个任务：重新 addUri；可选删除原任务记录。
 * @param {string} gid 原任务
 * @param {{ removeOld?: boolean }} [opts] removeOld=true 时从已停止结果里忘掉原任务（不动磁盘文件）
 * @returns {Promise<
 *   | { ok: true, gid: string }
 *   | { ok: false, reason: 'not-retryable' }
 * >} 成功返回新任务 gid；不可重建返回 not-retryable（addUri 自身抛错由调用方兜底）
 */
export async function retryTask(gid, opts = {}) {
  const payload = await buildRetryPayload(gid);
  if (!payload.ok) {
    return payload;
  }

  const newGid = await addTask(payload.uris, payload.options);

  if (opts.removeOld) {
    // 旧任务可能已不在结果里（并发/已清），失败不回滚刚建好的新任务
    try {
      await forgetTaskResult(gid);
    } catch {
      // 忽略：原记录不存在时 forget 会报错，重试本身已成功
    }
  }

  return { ok: true, gid: newGid };
}
