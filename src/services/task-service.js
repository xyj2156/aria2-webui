/**
 * 任务视图模型加工层（块 06 的完整实现，端口自 project 的 task-service.ts）。
 *
 * 把 aria2 原始结构体（整数字段是字符串、files/bittorrent 是嵌套）算成界面直接消费的
 * TaskVM / PeerVM。列表页（块 07）与详情页（块 10）都只吃这里的产物，加工只此一处。
 * 全部纯函数。多目录 BT 会构建虚拟文件树（目录节点 + 文件节点混排，靠 level 缩进渲染）。
 *
 * 需要展示的文案在这里只给 i18n 键（statusKey），由界面 t() 后显示。
 */

import { countCompletedPieces, getPieceStatus } from '@/utils/bitfield.js';
import { clientDisplayName } from '@/services/bt-peerid.js';

/** @typedef {import('../rpc/types.js').Aria2Task} Aria2Task */

/**
 * 文件视图模型（目录节点 type==='dir'、index===-1）。
 * @typedef {Object} FileVM
 * @property {'dir'|undefined} [type]
 * @property {number} index
 * @property {string} path
 * @property {string} fileName
 * @property {number} length
 * @property {number} completedLength
 * @property {boolean} selected
 * @property {boolean} [partialSelected]
 * @property {number} completePercent
 * @property {number} level
 * @property {string} relativePath
 * @property {string[]} [subDirs]
 * @property {number} [fileCount]
 * @property {[string,string]} [pieceRange]
 */

function toInt(value) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toFloatSafe(value) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isTrue(value) {
  return value === true || value === 'true';
}

/** 从文件路径或 URL 取展示名：去 query/hash、URL 解码 */
export function fileNameFromPath(path) {
  if (!path) {
    return '';
  }
  const tail = String(path).split(/[?#]/)[0].split(/[\\/]/).filter(Boolean).pop() ?? String(path);
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}

/** 连续同状态合并，供 canvas 进度条分段绘制（分块图用） */
export function getCombinedPieces(bitfield, numPieces) {
  const combined = [];
  for (const completed of getPieceStatus(bitfield, numPieces)) {
    const last = combined[combined.length - 1];
    if (last && last.isCompleted === completed) {
      last.count += 1;
    } else {
      combined.push({ isCompleted: completed, count: 1 });
    }
  }
  return combined;
}

function resolveTaskName(task, firstFilePath) {
  const btName = task.bittorrent?.info?.name;
  if (btName) {
    return { name: btName, hasName: true };
  }
  const fromFile = fileNameFromPath(firstFilePath) || fileNameFromPath(task.uri);
  if (fromFile) {
    return { name: fromFile, hasName: true };
  }
  return { name: '', hasName: false };
}

function toFileVM(file, position) {
  const length = toInt(file.length);
  const completedLength = toInt(file.completedLength);
  return {
    index: toInt(file.index) || position + 1,
    path: file.path,
    fileName: fileNameFromPath(file.path),
    length,
    completedLength,
    selected: isTrue(file.selected),
    completePercent: length > 0 ? Math.floor((completedLength / length) * 100) : 0,
    level: 0,
    relativePath: '',
    pieceRange: file.pieceRange,
  };
}

/** 相对保存目录与种子根目录的目录串（不含文件名），决定虚拟目录树 */
function relativeDirectoryOf(raw, taskName, file) {
  let path = String(file.path).replace(/\\/g, '/');
  const dir = String(raw.dir ?? '').replace(/\\/g, '/');
  if (dir && path.startsWith(dir)) {
    path = path.slice(dir.length);
  }
  path = path.replace(/^\/+/, '');

  const segments = path.split('/');
  segments.pop(); // 去文件名
  if (segments[0] === taskName) {
    segments.shift(); // 去种子根目录
  }
  return segments.join('/');
}

function makeRootDir() {
  return {
    node: {
      type: 'dir', index: -1, path: '', fileName: '', length: 0, completedLength: 0,
      selected: true, partialSelected: false, completePercent: 0, level: -1, relativePath: '',
      subDirs: [], fileCount: 0,
    },
    children: new Map(),
    files: [],
  };
}

/**
 * 多目录 BT 的虚拟文件树：按 relativePath 建树 → 文件挂叶目录 → 自底向上汇总
 * length/completedLength/selected 三态 → 深度优先摊平成数组（目录与文件混排）。
 * @param {Aria2Task} raw
 * @param {string} taskName
 * @param {FileVM[]} files
 * @returns {FileVM[]}
 */
function buildVirtualFileTree(raw, taskName, files) {
  const root = makeRootDir();
  const dirIndex = new Map([['', root]]);

  for (const file of files) {
    const relative = relativeDirectoryOf(raw, taskName, file);
    file.relativePath = relative;
    file.level = relative ? relative.split('/').length : 0;

    const segments = relative ? relative.split('/') : [];
    let parent = root;
    let prefix = '';
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let child = dirIndex.get(prefix);
      if (!child) {
        child = {
          node: {
            type: 'dir', index: -1, path: prefix, fileName: segment, length: 0, completedLength: 0,
            selected: true, partialSelected: false, completePercent: 0,
            level: prefix.split('/').length - 1, relativePath: prefix.split('/').slice(0, -1).join('/'),
            subDirs: [], fileCount: 0,
          },
          children: new Map(),
          files: [],
        };
        dirIndex.set(prefix, child);
        parent.children.set(segment, child);
        parent.node.subDirs = [...new Set([...(parent.node.subDirs ?? []), segment])];
      }
      parent = child;
    }
    parent.files.push(file);
  }

  const aggregate = (dir) => {
    let count = dir.files.length;
    let length = dir.files.reduce((sum, file) => sum + file.length, 0);
    let completed = dir.files.reduce((sum, file) => sum + (file.selected ? file.completedLength : 0), 0);
    let selectedCount = dir.files.filter((file) => file.selected).length;

    for (const child of dir.children.values()) {
      const sub = aggregate(child);
      count += sub.count;
      length += sub.length;
      completed += sub.completed;
      selectedCount += sub.selected;
    }

    dir.node.length = length;
    dir.node.completedLength = completed;
    dir.node.completePercent = length > 0 ? Math.floor((completed / length) * 100) : 0;
    dir.node.fileCount = count;
    dir.node.selected = count > 0 && selectedCount === count;
    dir.node.partialSelected = selectedCount > 0 && selectedCount < count;
    if (dir.node.partialSelected) {
      dir.node.selected = false;
    }
    return { count, length, completed, selected: selectedCount };
  };
  aggregate(root);

  const output = [];
  const walk = (dir) => {
    if (dir !== root) {
      output.push(dir.node);
    }
    const childDirs = [...dir.children.values()].sort((a, b) => a.node.fileName.localeCompare(b.node.fileName));
    for (const file of dir.files.sort((a, b) => a.index - b.index)) {
      output.push(file);
    }
    for (const child of childDirs) {
      walk(child);
    }
  };
  walk(root);
  return output;
}

/** 状态 → i18n 键（active 细分做种/下载中） */
function statusTextKey(status, seeder) {
  switch (status) {
    case 'active':
      return seeder ? 'task.status.seeding' : 'task.status.downloading';
    case 'waiting':
      return 'task.status.waiting';
    case 'paused':
      return 'task.status.paused';
    case 'complete':
      return 'task.status.completed';
    case 'error':
      return 'task.status.error';
    default:
      return 'task.status.removed';
  }
}

/**
 * 加工单个任务；addVirtualFileNode 为真且多文件 BT（bittorrent.mode==='mr'）时产出虚拟目录树。
 * @param {Aria2Task} raw
 * @param {{ addVirtualFileNode?: boolean, orderIndex?: number }} [options]
 */
export function processDownloadTask(raw, options = {}) {
  const rawFiles = raw.files ?? [];
  const files = rawFiles.map(toFileVM);
  const totalLength = toInt(raw.totalLength);
  const completedLength = toInt(raw.completedLength);
  const downloadSpeed = toInt(raw.downloadSpeed);
  const pieceLength = toInt(raw.pieceLength);
  const numPieces = toInt(raw.numPieces) || (pieceLength > 0 ? Math.ceil(totalLength / pieceLength) : 0);
  const verifiedLength = toInt(raw.verifiedLength);
  const remainLength = Math.max(0, totalLength - completedLength);
  const seeder = isTrue(raw.seeder);
  const { name: taskName, hasName } = resolveTaskName(raw, rawFiles[0]?.path);

  const firstUris = rawFiles[0]?.uris ?? [];
  const singleUrl =
    rawFiles.length === 1 && firstUris.length > 0 && firstUris.every((uri) => uri.uri === firstUris[0].uri)
      ? firstUris[0].uri
      : undefined;

  const isMultiFileBT = raw.bittorrent?.mode === 'mr' && files.length > 1;
  const treeApplied = Boolean(options.addVirtualFileNode) && isMultiFileBT;
  const status = raw.status;

  return {
    raw,
    gid: raw.gid,
    status,
    dir: raw.dir ?? '',
    protocol: raw.protocol,
    infoHash: raw.infoHash,
    errorCode: raw.errorCode || undefined,
    errorMessage: raw.errorMessage ? String(raw.errorMessage) : '',
    bitfield: raw.bitfield ?? '',
    startTime: toInt(raw.startTime),
    endTime: raw.endTime === undefined ? undefined : toInt(raw.endTime),
    totalLength,
    completedLength,
    uploadLength: toInt(raw.uploadLength),
    verifiedLength,
    verifyIntegrityPending: isTrue(raw.verifyIntegrityPending),
    verifiedPercent:
      verifiedLength > 0 && completedLength > 0 ? Math.floor((verifiedLength / completedLength) * 100) : undefined,
    downloadSpeed,
    uploadSpeed: toInt(raw.uploadSpeed),
    numPieces,
    pieceLength,
    completedPieces: countCompletedPieces(raw.bitfield ?? '', numPieces),
    completePercent:
      totalLength > 0
        ? Math.floor((completedLength / totalLength) * 100)
        : status === 'complete'
          ? 100
          : 0,
    remainLength,
    remainPercent: totalLength > 0 ? (remainLength / totalLength) * 100 : 0,
    remainTime: downloadSpeed > 0 ? remainLength / downloadSpeed : 0,
    shareRatio: completedLength > 0 ? toInt(raw.uploadLength) / completedLength : toFloatSafe(raw.shareRatio),
    idle: downloadSpeed === 0,
    seeder,
    connections: toInt(raw.connections ?? raw.numDownloadConnections),
    numSeeders: toInt(raw.numSeeders),
    taskName,
    hasTaskName: hasName,
    files: treeApplied ? buildVirtualFileTree(raw, taskName, files) : files,
    selectedFileCount: files.filter((file) => file.selected).length,
    singleUrl,
    isBT: Boolean(raw.bittorrent) || isTrue(raw.isTorrent),
    isMultiFileBT,
    orderIndex: options.orderIndex ?? 0,
    // ↓ 列表/详情共用的 UI 派生（对齐 project 之外，为 -new 单组件复用而加）
    statusKey: statusTextKey(status, seeder),
    isDone: status === 'complete',
    canPause: status === 'active',
    canResume: status === 'paused' || status === 'error',
    canStartNow: status === 'waiting',
  };
}

/**
 * 列表批量归一（不去重，交给界面 :key；aria2 一般不会返回重复 gid）。
 * @param {Aria2Task[]} raws
 * @param {{ addVirtualFileNode?: boolean }} [options]
 */
export function processTaskList(raws, options = {}) {
  const list = Array.isArray(raws) ? raws : [];
  return list.map((raw, index) => processDownloadTask(raw, { orderIndex: index, ...options }));
}

/**
 * peer 加工：aria2 给的 speed 是「该 peer 的下载速率」，即本机的上行贡献，
 * 所以展示上与我方下载速率互换位置（旧实现同处理）。
 * @param {Array<Record<string, unknown>>} peers
 * @param {Pick<ReturnType<typeof processDownloadTask>, 'numPieces'|'completePercent'|'bitfield'|'completedPieces'|'pieceLength'>} task
 * @param {boolean} [includeLocalPeer]
 */
export function processBtPeers(peers, task, includeLocalPeer = false) {
  const localPercent = task.completePercent;
  const list = Array.isArray(peers) ? peers : [];
  const result = list.map((peer) => {
    const completed = countCompletedPieces(peer.bitfield, task.numPieces);
    const completePercent = task.numPieces > 0 ? Math.floor((completed / task.numPieces) * 100) : 0;
    const speed = toInt(peer.speed);
    return {
      peerId: peer.peerId,
      name: `${peer.peerAddress}:${peer.peerPort}`,
      clientName: clientDisplayName(peer.peerId),
      bitfield: peer.bitfield ?? '',
      completedLength: completed * (task.pieceLength ?? 0),
      completePercent: completed === task.completedPieces ? localPercent : completePercent,
      downloadSpeed: 0,
      uploadSpeed: speed,
      seeder: task.numPieces > 0 && completed === task.numPieces,
    };
  });

  if (includeLocalPeer) {
    result.push({
      name: '(local)', clientName: '(local)', bitfield: task.bitfield, completedLength: 0,
      completePercent: localPercent, downloadSpeed: 0, uploadSpeed: 0, seeder: false, local: true,
    });
  }
  return result;
}

/**
 * 健康度：统计每个未持有分片被多少 peer 持有，能凑齐的块数 + 本地块数。
 * @param {ReturnType<typeof processDownloadTask>} task
 * @param {Array<{bitfield: string}>} peers
 * @returns {number}
 */
export function estimateHealthPercentFromPeers(task, peers) {
  if (task.numPieces <= 0 || !peers || peers.length === 0) {
    return task.completePercent;
  }
  if (task.completedPieces >= task.numPieces) {
    return 100;
  }
  const owned = getPieceStatus(task.bitfield, task.numPieces);
  const availability = new Array(task.numPieces).fill(0);
  for (const peer of peers) {
    getPieceStatus(peer.bitfield, task.numPieces).forEach((has, index) => {
      if (has) {
        availability[index] += 1;
      }
    });
  }
  const obtainable = availability.filter((count, index) => count > 0 && !owned[index]).length;
  const reachable = Math.min(task.numPieces, task.completedPieces + obtainable);
  return Math.min(100, Math.floor((reachable / task.numPieces) * 100));
}
