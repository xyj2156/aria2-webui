/**
 * 新建任务链接解析（纯函数，不碰 DOM、不认识译文，方便 Node 里直接断言）。
 *
 * 语义对齐旧版 AriaNg 的 ng-valid-urls：多行文本，一行一条，只认 http/https/ftp/sftp
 * 与带可识别哈希摘要的 magnet；其余行计入「忽略」但不报错（宁可少建也不误吞用户输入）。
 * 返回值里的每条 url 后续各自成一个任务（每行一个任务），镜像合成本工程不做。
 */

/** 可直接建 HTTP/FTP 下载的任务协议 */
const DOWNLOADABLE_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'sftp:']);

/**
 * 单行是否是一个 aria2 能受理的下载链接。
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isDownloadableUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) {
    return false;
  }

  // 磁力链：必须含 btih/xt 之类的 info-hash 参数，aria2 才解析得出 BT 任务
  if (/^magnet:/i.test(value)) {
    return /(?:[?&])(?:btih|xt|dn|tr)=/i.test(value);
  }

  try {
    return DOWNLOADABLE_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    // 非绝对 URL（漏写协议等）一律视为无效行
    return false;
  }
}

/**
 * 逐行解析原始输入。
 * @param {unknown} text textarea 的原始字符串
 * @returns {{ urls: string[], ignored: number }} urls=有效链接（已 trim、保序），ignored=被跳过的非空行数
 */
export function parseUrlsFromOriginInput(text) {
  const lines = String(text ?? '').split(/\r\n|\n|\r/);
  const urls = [];
  let ignored = 0;

  for (const line of lines) {
    const value = line.trim();
    if (!value) {
      continue; // 空行既不算有效也不算忽略
    }
    if (isDownloadableUrl(value)) {
      urls.push(value);
    } else {
      ignored += 1;
    }
  }

  return { urls, ignored };
}
