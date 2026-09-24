/**
 * BitTorrent peer id 客户端识别（旧 angular-bittorrent-peerid 的等价实现，覆盖常见客户端）。
 * 约定：peer id 形如 `-XX1234-…`，前缀字母是客户端代号，其余是版本数字。
 */

const CLIENT_TABLE = {
  A: 'ABC',
  AE: 'AngelDrive',
  AR: 'Arctic',
  AV: 'Avicora',
  AX: 'BitPump',
  AZ: 'Azureus / Vuze',
  BC: 'BitComet',
  BE: 'BitTorrent',
  BF: 'BitFlu',
  BG: 'BigFoot',
  BI: 'BigRago',
  BS: 'BitSpirit',
  BX: 'Bittorrent X',
  CD: 'Enhanced CTorrent',
  DA: 'Poco',
  DT: 'Deluge Torrent',
  HB: 'Hibit',
  HL: 'Halite',
  KT: 'KTorrent',
  LB: 'Libtorrent',
  LC: 'LibCode',
  LL: 'Lighthouse',
  LTR: 'Lt Ratio',
  MP: 'Morpheus',
  NL: 'Nova',
  PE: 'Peerless',
  QB: 'qBittorrent',
  RT: 'Retvii Wheeler',
  SA: 'Solver',
  SD: 'XBackup',
  SS: 'Sw Swarm',
  ST: 'Sunflower Torrent Spider',
  SU: 'Swiftbit',
  TG: 'Teleport',
  TR: 'Transmission',
  TS: 'SwiftStream',
  UT: 'uTorrent',
  VG: 'VideoGorilla',
  XL: 'Xunlei',
};

/** '4' '12' '123' '1234' → '4', '1.2', '1.2.3', '1.2.3.4' */
export function formatVersion(digits) {
  if (!digits) {
    return '';
  }
  const clean = digits.replace(/[^0-9]/g, '');
  if (clean.length <= 1) {
    return clean;
  }
  return clean
    .split('')
    .join('.')
    .replace(/(\.){2,}/g, '.');
}

/**
 * aria2 getPeers 的 peerId 经 torrentPercentEncode 编码（`-` 变 `%2D` 等），解析前先还原。
 * 逐字节 String.fromCharCode，不能用 decodeURIComponent：后者按 UTF-8 解码，遇到 peerId 里的
 * 非 UTF-8 字节序列（如 `%96%B8`）会抛 URIError。客户端识别只靠前缀 ASCII，尾部乱码不影响。
 * @param {unknown} peerId
 * @returns {string}
 */
export function decodePeerId(peerId) {
  if (typeof peerId !== 'string') {
    return '';
  }
  return peerId.replace(/%[0-9A-Fa-f]{2}/g, (token) => String.fromCharCode(parseInt(token.slice(1), 16)));
}

/**
 * 解析 peer id。
 * @param {string|undefined} rawPeerId aria2 原始（百分号编码）peerId
 * @returns {{ name: string, version: string, supported: boolean }}
 */
export function parsePeerClient(rawPeerId) {
  const fallback = { name: 'Unknown', version: '', supported: false };
  const peerId = decodePeerId(rawPeerId);
  if (!peerId || peerId.length < 3) {
    return fallback;
  }
  const body = peerId.startsWith('-') ? peerId.slice(1) : peerId;
  const matched = /^([A-Za-z]{1,3})([0-9.]*)/.exec(body);
  if (!matched) {
    return fallback;
  }
  const code = matched[1].toUpperCase();
  const digits = matched[2] ?? '';
  const name = CLIENT_TABLE[code];
  return { name: name ?? code, version: formatVersion(digits), supported: Boolean(name) };
}

/** 展示名：`qBittorrent 3.3.12`（无版本时只给名字） */
export function clientDisplayName(peerId) {
  const client = parsePeerClient(peerId);
  return client.version ? `${client.name} ${client.version}` : client.name;
}
