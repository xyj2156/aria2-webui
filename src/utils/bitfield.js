/**
 * aria2 bitfield 的解码（16 进制字符串，每字符 4 bit，片索引高位在前）。
 * 只保留生产代码要用的读侧函数；写侧（造 mock 位图）在需要时再加，避免生产包背无用代码。
 */

const HEX_DIGITS = '0123456789abcdef';

/** 片索引 i 的位所在字符与字符内位权（高位在前） */
function locate(piece) {
  return { charIndex: Math.floor(piece / 4), mask: 1 << (3 - (piece % 4)) };
}

/**
 * 某一分片是否已完成。
 * @param {string|undefined} bitfield
 * @param {number} piece
 * @returns {boolean}
 */
export function isPieceCompleted(bitfield, piece) {
  if (!bitfield || piece < 0) {
    return false;
  }
  const { charIndex, mask } = locate(piece);
  if (charIndex >= bitfield.length) {
    return false;
  }
  const value = Number.parseInt(bitfield.charAt(charIndex), 16);
  return Number.isFinite(value) && (value & mask) !== 0;
}

/**
 * 已完成分片计数。
 * @param {string} bitfield
 * @param {number} numPieces
 * @returns {number}
 */
export function countCompletedPieces(bitfield, numPieces) {
  let count = 0;
  for (let piece = 0; piece < numPieces; piece += 1) {
    if (isPieceCompleted(bitfield, piece)) {
      count += 1;
    }
  }
  return count;
}

/**
 * 展开成布尔数组（分块图逐格渲染用）。
 * @param {string|undefined} bitfield
 * @param {number} numPieces
 * @returns {boolean[]}
 */
export function getPieceStatus(bitfield, numPieces) {
  const status = [];
  if (!bitfield || numPieces <= 0) {
    return status;
  }
  for (let piece = 0; piece < numPieces; piece += 1) {
    status.push(isPieceCompleted(bitfield, piece));
  }
  return status;
}

/**
 * 按固定组大小聚合位图 —— 分片方块图的降 DOM 手段：一格代表 groupSize 个原始分片，
 * 组内完成数与比例留给上层决定怎么画（全完成 / 部分完成 / 全未完成）。
 * 末组可能不足 groupSize 片，count 如实返回，格数 = ceil(numPieces / groupSize)。
 * @param {string|undefined} bitfield
 * @param {number} numPieces
 * @param {number} [groupSize=1] 每格代表的原始片数，1 = 逐片
 * @returns {{ index:number, start:number, end:number, count:number, completed:number, ratio:number }[]}
 *   start 含、end 不含（数组切片语义），start/end 是 0 基片索引
 */
export function getGroupedPieces(bitfield, numPieces, groupSize = 1) {
  const groups = [];
  const size = Math.max(1, Math.floor(groupSize) || 1);
  if (!bitfield || numPieces <= 0) {
    return groups;
  }
  for (let start = 0; start < numPieces; start += size) {
    const end = Math.min(start + size, numPieces);
    let completed = 0;
    for (let piece = start; piece < end; piece += 1) {
      if (isPieceCompleted(bitfield, piece)) {
        completed += 1;
      }
    }
    groups.push({
      index: groups.length,
      start,
      end,
      count: end - start,
      completed,
      ratio: completed / (end - start),
    });
  }
  return groups;
}

/**
 * 由「期望格数上限」反推组大小：至少 1（即逐片）。
 * @param {number} numPieces
 * @param {number} targetCells
 * @returns {number}
 */
export function resolveGroupSize(numPieces, targetCells) {
  if (!(numPieces > 0) || !(targetCells > 0)) {
    return 1;
  }
  return Math.max(1, Math.ceil(numPieces / targetCells));
}

export { HEX_DIGITS };
