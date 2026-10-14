/**
 * 采纳启动链接里带来的 RPC 密钥（形如 http://localhost:6800/#rpc-secret=xxx）。
 *
 * 为什么要这个能力：发布包规定了「暴露即鉴权」——面板一旦开到局域网就必须带
 * rpc-secret，Linux/macOS 的 start.sh 首启会生成随机密钥追加进 aria2.conf，并打印
 * 一条已经把密钥填好的链接。让用户再把 32 位十六进制串抄进设置页，等于把省事变
 * 成了麻烦，所以这里负责把那条链接直接吃进连接配置。
 *
 * 为什么拆成两步（顺序是硬约束，不能合并）：
 *   1. 摘密钥的动作在本模块被 import 时自动完成，因此 main.js 里必须把对它的 import
 *      排在 './main.vue'、'./router' 之前。hash 路由在**模块求值阶段**就按当前地址定下
 *      初始路由（不是等到 app.use(router)），晚了 `#rpc-secret=xxx` 会被规范化成
 *      `#/rpc-secret=xxx`——实测密钥虽然还读得到，但路由已经匹配不到页面，整页空白。
 *   2. applyUrlSecret() 在 main.vue 里、setActive() 之前调用。那时 pinia 才可用，
 *      而首次 RPC 连接还没发出，避免「先用空密钥连一次、失败再换密钥」的闪烁。
 *
 * 安全边界：链接里没有 rpc-secret 就完全无操作，正常访问路径零影响。带密钥时被外部
 * 页面导航过来确实能改写本地存的密钥，但那是「连不上」级别的干扰——把真值换掉并不能
 * 让攻击者拿到真值（面板从不回显已存密钥，HTTP 通道的跨站请求又被 CORS 拦住），用户
 * 重开一次启动链接或在设置页改回来即可。注意 WS 通道不受 CORS 约束，所以密码本身才是
 * 防线，见 transport-ws.js 的头注释。
 */
import { useConnectionStore } from '@/store/connections.js';

/** 链接里携带密钥的参数名 */
const SECRET_PARAM = 'rpc-secret';
/**
 * 匹配 hash 或 query 片段里的 `rpc-secret=<值>`，值到下一个 & 或 # 为止。
 * 分隔符集合里带上 `/` 是必需的：hash 路由会在入口处把 `#rpc-secret=x` 规范成
 * `#/rpc-secret=x`（实测浏览器地址栏里就是这个形态），只认 ?&# 会漏掉这一种。
 */
const SECRET_PATTERN = new RegExp(`(?:^|[?&#/])${SECRET_PARAM}=([^&#]+)`);
/** 清理地址时要去掉的所有同款片段（`#` 开头的整段保留 `#`，其余连分隔符一起删） */
const SECRET_STRIP_PATTERN = new RegExp(`([?&#/])${SECRET_PARAM}=[^&#]*`, 'g');

/** @type {string | null} 摘下来但尚未写入配置的密钥 */
let captured = null;

/**
 * 把百分号编码还原成原值；解不开就当原值（启动脚本写的是十六进制，通常不需要解码）。
 * @param {string} raw
 * @returns {string}
 */
function decodeSecret(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * 把密钥从地址栏抹掉，免得它留在浏览历史里被人翻到。
 * 失败（file:// 打开、或浏览器不允许改地址）不影响连接：密钥已经拿到了。
 * @param {Location} loc
 * @param {History} [history]
 */
function stripFromAddress(loc, history) {
  if (!history || typeof history.replaceState !== 'function') return;
  try {
    const url = new URL(loc.href);
    url.searchParams.delete(SECRET_PARAM);
    // hash 里既可能是 `#rpc-secret=x`（整段就是密钥），也可能是 `#/tasks?rpc-secret=x`
    //（路由后面挂的参数），两种都要清干净且不能把路由本身弄丢。
    const cleanedHash = url.hash
      .replace(SECRET_STRIP_PATTERN, (_m, sep) => (sep === '#' ? '#' : ''))
      .replace(/[?&]$/, '');
    url.hash = cleanedHash === '#' ? '' : cleanedHash;
    history.replaceState(null, '', url.toString());
  } catch {
    // 地址改不动就算了，静默继续
  }
}

/**
 * 第一步：从当前地址里摘出密钥并从地址栏抹掉。必须在安装路由之前调用。
 * 幂等，重复调用只认第一次的地址。
 * @param {Location} [loc] 便于单测注入
 * @param {History} [history] 便于单测注入
 * @returns {string | null} 摘到的密钥，没有则 null
 */
export function captureUrlSecret(loc = globalThis.location, history = globalThis.history) {
  if (captured !== null) return captured;
  if (!loc || !loc.href) return null;

  let raw = null;
  const inHash = SECRET_PATTERN.exec(loc.hash || '');
  if (inHash) {
    raw = inHash[1];
  } else {
    try {
      raw = new URL(loc.href).searchParams.get(SECRET_PARAM);
    } catch {
      raw = null;
    }
  }
  if (!raw) return null;

  captured = decodeSecret(raw);
  stripFromAddress(loc, history);
  return captured;
}

/**
 * 第二步：把摘到的密钥写进连接配置。
 *
 * 归属规则：优先写进「 host + 端口与当前页面一致」的那条连接——面板与 RPC 同源，
 * 页面从哪来就连哪；一条都对不上时（手机/其它电脑第一次打开这条链接）新建一条并
 * 激活，否则用户点了链接还要手工填一遍地址，这条链接就没意义了。
 *
 * @returns {boolean} 是否采纳了一个密钥（没带密钥时返回 false，绝不改动任何配置）
 */
export function applyUrlSecret() {
  if (!captured) return false;
  const secret = captured;
  captured = null;

  const loc = globalThis.location;
  if (!loc || !loc.hostname) return false;

  const store = useConnectionStore();
  const host = loc.hostname;
  // 地址栏省略默认端口时 location.port 是空串，这里补齐后再比对，否则永远匹配不上
  const port = Number(loc.port) || (loc.protocol === 'https:' ? 443 : 80);

  const target = store.connections.find((conn) => conn.host === host && Number(conn.port) === port);
  if (target) {
    // 只改密钥：协议是用户可能自己选过的，不顺手覆盖
    store.updateConnection(target.id, {secret});
    store.setActive(target.id);
    return true;
  }

  // 新建时不指定 protocol，交给 store 的同源推断（面板由 aria2c 自己提供 → ws/wss）
  const added = store.addConnection({name: host, host, port, secret});
  if (added.ok) store.setActive(added.id);
  return added.ok;
}

// 入口副作用：模块被 import 的那一瞬间就摘密钥。ESM 里 import 会被提升，函数体永远
// 晚于 './router' 的求值，所以只能靠这里抢；main.js 因此把本模块的 import 排在
// './main.vue' 与 './router' 之前。captureUrlSecret 幂等，重复调用或被人手动再调一次都安全。
captureUrlSecret();
