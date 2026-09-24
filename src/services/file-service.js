/**
 * 本地文件读取（块 09 新建任务的种子/磁链上传，端口自旧版 ariaNgFileService.openFileContent）。
 *
 * 只暴露一个能力：把用户选的 File 读成 aria2.addTorrent / addMetalink 需要的 base64。
 * 走原生 FileReader.readAsDataURL，剥掉 `data:...;base64,` 前缀即得纯 base64，不引任何库。
 *
 * 失败一律 reject 一个 Error，其 message 是「错误码」（no-file / empty / too-large /
 * read-failed），由界面层 t() 成具体文案——本文件不认识译文，方便在别处复用与测试。
 * 空文件与超大文件提前拦截：0 字节 aria2 会直接报错，超大 blob 会把 RPC 请求体撑爆。
 */

/** 上传文件大小上限（16 MiB，远超 rpc-max-request-size 默认 2M，留足冗余） */
export const MAX_UPLOAD_FILE_BYTES = 16 * 1024 * 1024;

/**
 * 读文件为 base64。
 * @param {File} file 来自 <input type=file> 的 File 对象
 * @returns {Promise<{ fileName: string, content: string }>} content 为纯 base64（已去 dataURL 前缀）
 * @throws {Error} message 为错误码
 */
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('no-file'));
      return;
    }
    if (file.size === 0) {
      reject(new Error('empty'));
      return;
    }
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      reject(new Error('too-large'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const comma = dataUrl.indexOf(',');
      resolve({
        fileName: file.name,
        // 没有逗号说明不是标准 dataURL，兜底原样返回（正常浏览器不会走到这支）
        content: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
      });
    };
    reader.onerror = () => reject(new Error('read-failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * 依据文件名扩展名判定上传类型。
 * @param {string} fileName
 * @returns {'torrent' | 'metalink' | ''} '' 表示扩展名不认识
 */
export function detectUploadKind(fileName) {
  const name = String(fileName ?? '').toLowerCase();
  if (name.endsWith('.torrent')) {
    return 'torrent';
  }
  if (name.endsWith('.metalink') || name.endsWith('.meta4')) {
    return 'metalink';
  }
  return '';
}
