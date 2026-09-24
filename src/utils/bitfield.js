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

export { HEX_DIGITS };
