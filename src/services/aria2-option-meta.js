/**
 * aria2 选项元数据（块 08 §1，端口自 project 的 aria2-option-meta.ts）。
 *
 * 只描述「渲染与校验需要知道的属性」：类型、单位、默认值、取值域、范围、分隔符、提交形态。
 * 显示名与说明文案是 i18n 键 `options.<key>.name/.description`（见 locale YAML 的 options 段）。
 *
 * 收录范围：8 个全局分组 + 快捷设置 + 任务级选项里出现的键。未登记的 aria2 选项
 * 退化为纯文本框渲染，不阻断（宁可少校验也不误拦用户输入）。
 *
 * 新增或修改这里的键与取值域，必须三处核对，别凭印象（本文件此前就混进了
 * aria-ng 时代遗留的 http-auth-method、rpc-ca 两个 aria2 1.37.0 并不存在的键，
 * 以及 ftp-pasv=auto/passive/active、follow-torrent=memonly 两个非法取值）：
 *   1. `aria2c --help=all` 里有没有这个选项名与这些取值；
 *   2. 上游源码 src/prefs.cc 的 makePref("…") 是否注册了该名字；
 *   3. 官网手册 aria2c.html 该选项段落写的取值集合与默认值（锚点 id="cmdoption-<名>"）。
 * 为什么必须实测：aria2 的 changeGlobalOption 对**不存在的键**一律回 "OK"（静默无效），
 * 只有**非法取值**才会真报错，所以"保存成功"证明不了任何事；写回后用
 * aria2.getGlobalOption 读回，才知道是否真被接受。
 */

const S = (key, extra = {}) => ({ key, type: 'string', ...extra });
const N = (key, extra = {}) => ({ key, type: 'integer', min: 0, defaultValue: '0', ...extra });
const F = (key, extra = {}) => ({ key, type: 'float', min: 0, ...extra });
const B = (key, extra = {}) => ({ key, type: 'boolean', options: ['true', 'false'], defaultValue: 'false', ...extra });
const E = (key, options, extra = {}) => ({ key, type: 'option', options, ...extra });
const T = (key, extra = {}) => ({ key, type: 'text', separator: '\n', submitFormat: 'array', showCount: true, trimCount: true, overrideMode: 'append', ...extra });
const SZ = (key, extra = {}) => ({ key, type: 'string', suffix: 'Bytes', defaultValue: '0', ...extra });
const SEC = (key, extra = {}) => ({ key, type: 'integer', suffix: 'Seconds', min: 0, defaultValue: '0', ...extra });
const MS = (key, extra = {}) => ({ key, type: 'integer', suffix: 'Milliseconds', min: 0, defaultValue: '0', ...extra });

const LOG_LEVELS = ['debug', 'info', 'notice', 'warn', 'err'];
const YES_NO = ['true', 'false'];

/** 全量字典：键即 aria2 选项名（去 --） */
export const OPTION_META = Object.fromEntries(
  [
    // 基础
    S('dir', { defaultValue: '.', required: true }),
    S('log'),
    E('log-level', LOG_LEVELS, { defaultValue: 'notice' }),
    N('max-concurrent-downloads', { defaultValue: '5', min: 1, overrideMode: 'override' }),
    B('check-integrity'),
    B('continue'),
    B('dry-run'),
    B('rpc-save-upload-metadata', { defaultValue: 'true' }),

    // HTTP / FTP / 代理
    S('all-proxy'),
    S('all-proxy-user'),
    S('all-proxy-passwd'),
    S('http-proxy'),
    S('http-proxy-user'),
    S('http-proxy-passwd'),
    S('https-proxy'),
    S('https-proxy-user'),
    S('https-proxy-passwd'),
    S('ftp-proxy'),
    S('ftp-proxy-user'),
    S('ftp-proxy-passwd'),
    E('proxy-method', ['get', 'tunnel'], { defaultValue: 'get' }),
    S('no-proxy'),
    S('netrc-path', { defaultValue: '~/.netrc' }),
    B('no-netrc'),
    MS('connect-timeout', { defaultValue: '60000' }),
    SEC('timeout', { defaultValue: '60' }),
    SEC('retry-wait'),
    N('max-tries', { defaultValue: '5' }),
    N('max-file-not-found'),
    SZ('lowest-speed-limit'),
    N('max-connection-per-server', { defaultValue: '1', min: 1, max: 16 }),
    SZ('min-split-size', { defaultValue: '20M' }),
    N('split', { defaultValue: '5', min: 1, max: 512 }),
    E('stream-piece-selector', ['default', 'random', 'inorder', 'geom'], { defaultValue: 'default' }),
    E('uri-selector', ['inorder', 'feedback', 'adaptive'], { defaultValue: 'feedback' }),
    B('check-certificate', { defaultValue: 'true' }),
    B('http-accept-gzip'),
    B('http-auth-challenge'),
    B('http-no-cache'),
    B('use-head'),
    S('http-user'),
    S('http-passwd'),
    // 注：aria-ng 老版有 http-auth-method（basic/digest 选择），aria2 1.37.0 里
    // 并没有这个选项（--help=all、prefs.cc 的 makePref、官网手册三处都查无此项），
    // 只有 http-auth-challenge；且 aria2 的 changeGlobalOption 对不存在的键也回
    // "OK"，写进去只会静默无效，故不再收录。rpc-ca 同理（真实的是
    // rpc-certificate / rpc-private-key，见下）。
    B('no-want-digest-header'),
    B('enable-http-keep-alive', { defaultValue: 'true' }),
    B('enable-http-pipelining'),
    T('header'),
    S('referer'),
    S('user-agent', { defaultValue: 'aria2/' }),
    B('save-cookies'),
    B('reuse-uri'),
    B('remote-time'),
    S('server-stat-of'),
    S('server-stat-if'),
    SEC('server-stat-timeout', { defaultValue: '86400' }),
    S('ftp-user'),
    S('ftp-passwd'),
    // 官网：--ftp-pasv [true|false]，默认 true（false 即主动模式）；旧表里的
    // auto/passive/active 是 aria-ng 时代的写法，实测写 'passive' 会被 aria2 拒绝。
    B('ftp-pasv', { defaultValue: 'true' }),
    // 官网原文：TYPE 取 binary 或 ascii，默认 binary，SFTP 传输时忽略此选项。
    E('ftp-type', ['binary', 'ascii'], { defaultValue: 'binary' }),
    B('ftp-reuse-connection', { defaultValue: 'true' }),
    S('ssh-host-key-md'),

    // BitTorrent
    B('bt-detach-seed-only'),
    B('bt-enable-hook-after-hash-check', { defaultValue: 'true' }),
    B('bt-enable-lpd'),
    T('bt-exclude-tracker', { separator: ',' }),
    S('bt-external-ip'),
    B('bt-force-encryption'),
    B('bt-hash-check-seed', { defaultValue: 'true' }),
    // 磁力链下元数据前先读 --bt-save-metadata 存过的文件，读到就不再问 DHT。
    B('bt-load-saved-metadata'),
    N('bt-max-open-files', { defaultValue: '100', min: 1 }),
    N('bt-max-peers', { defaultValue: '55' }),
    B('bt-metadata-only'),
    E('bt-min-crypto-level', ['plain', 'arc4'], { defaultValue: 'plain' }),
    T('bt-prioritize-piece', { separator: ',', submitFormat: 'string' }),
    B('bt-remove-unselected-file'),
    B('bt-require-crypto'),
    SZ('bt-request-peer-speed-limit', { defaultValue: '50K' }),
    B('bt-save-metadata'),
    B('bt-seed-unverified'),
    SEC('bt-stop-timeout'),
    T('bt-tracker', { separator: ',' }),
    MS('bt-tracker-connect-timeout', { defaultValue: '10000' }),
    SEC('bt-tracker-interval'),
    SEC('bt-tracker-timeout', { defaultValue: '10' }),
    S('dht-file-path', { defaultValue: '~/.aria2/dht.dat' }),
    S('dht-file-path6', { defaultValue: '~/.aria2/dht6.dat' }),
    N('dht-listen-port', { defaultValue: '6881', min: 1, max: 65535 }),
    MS('dht-message-timeout', { defaultValue: '1000' }),
    B('enable-dht', { defaultValue: 'true' }),
    B('enable-dht6'),
    B('enable-peer-exchange', { defaultValue: 'true' }),
    // 第三个取值官网写的是 mem，不是 memonly（实测 memonly 会被 aria2 拒绝）。
    E('follow-torrent', [...YES_NO, 'mem'], { defaultValue: 'true' }),
    N('listen-port', { defaultValue: '6881', min: 1, max: 65535 }),
    SZ('max-overall-upload-limit'),
    SZ('max-upload-limit'),
    S('peer-id-prefix', { defaultValue: '-AR' }),
    S('peer-agent'),
    F('seed-ratio', { defaultValue: '1.0' }),
    SEC('seed-time', { defaultValue: '1' }),

    // Metalink
    E('follow-metalink', [...YES_NO, 'mem'], { defaultValue: 'true' }),
    S('metalink-base-uri'),
    S('metalink-language'),
    S('metalink-location'),
    S('metalink-os'),
    S('metalink-version'),
    E('metalink-preferred-protocol', ['http', 'https', 'ftp', 'none'], { defaultValue: 'none' }),
    B('metalink-enable-unique-protocol', { defaultValue: 'true' }),

    // RPC
    B('enable-rpc'),
    B('pause-metadata'),
    B('rpc-allow-origin-all'),
    B('rpc-listen-all'),
    N('rpc-listen-port', { defaultValue: '6800', min: 1, max: 65535 }),
    SZ('rpc-max-request-size', { defaultValue: '2M' }),
    B('rpc-secure'),
    S('rpc-certificate'),
    S('rpc-private-key'),

    // 高级
    B('allow-overwrite'),
    B('allow-piece-length-change'),
    B('always-resume', { defaultValue: 'true' }),
    B('async-dns', { defaultValue: 'true' }),
    B('auto-file-renaming', { defaultValue: 'true' }),
    SEC('auto-save-interval', { defaultValue: '60' }),
    B('conditional-get'),
    S('console-log-level', { defaultValue: 'notice' }),
    S('content-disposition-default-utf8'),
    B('daemon'),
    B('deferred-input'),
    B('disable-ipv6'),
    SZ('disk-cache'),
    E('download-result', ['default', 'hide', 'full'], { defaultValue: 'default' }),
    S('dscp'),
    // 与下面的 file-allocation 有关：未预分配空间时映射可能不生效（官网原话）。
    B('enable-mmap'),
    E('file-allocation', ['none', 'prealloc', 'falloc', 'trunc'], { defaultValue: 'prealloc' }),
    B('force-save'),
    B('hash-check-only'),
    B('human-readable', { defaultValue: 'true' }),
    B('keep-unfinished-download-result', { defaultValue: 'true' }),
    N('max-download-limit', { defaultValue: '0' }),
    N('max-download-result', { defaultValue: '1000' }),
    N('max-mmap-limit'),
    N('max-overall-download-limit', { defaultValue: '0' }),
    N('max-resume-failure-tries'),
    S('min-tls-version'),
    S('no-conf'),
    SZ('no-file-allocation-limit', { defaultValue: '512M' }),
    B('optimize-concurrent-downloads'),
    B('parameterized-uri'),
    SZ('piece-length', { defaultValue: '1M' }),
    B('quiet'),
    B('realtime-chunk-checksum', { defaultValue: 'true' }),
    B('remove-control-file'),
    S('save-session'),
    SEC('save-session-interval', { defaultValue: '30' }),
    B('save-not-found', { defaultValue: 'true' }),
    N('socket-recv-buffer-size'),
    SEC('stop'),
    B('show-console-readout', { defaultValue: 'true' }),
    SEC('summary-interval', { defaultValue: '60' }),
    B('truncate-console-readout', { defaultValue: 'true' }),
  ].map((meta) => [meta.key, meta]),
);

/** 8 个全局分类的键表（顺序即渲染顺序） */
export const GLOBAL_OPTION_GROUPS = {
  basic: ['dir', 'log', 'log-level', 'max-concurrent-downloads', 'check-integrity', 'continue'],
  'http-ftp-sftp': [
    'all-proxy', 'all-proxy-user', 'all-proxy-passwd', 'connect-timeout', 'dry-run',
    'lowest-speed-limit', 'max-connection-per-server', 'max-file-not-found', 'max-tries',
    'min-split-size', 'netrc-path', 'no-netrc', 'no-proxy', 'proxy-method', 'remote-time',
    'reuse-uri', 'retry-wait', 'server-stat-of', 'server-stat-timeout', 'split',
    'stream-piece-selector', 'timeout', 'uri-selector',
  ],
  http: [
    'check-certificate', 'http-accept-gzip', 'http-auth-challenge', 'http-no-cache', 'http-user',
    'http-passwd', 'http-proxy', 'http-proxy-user', 'http-proxy-passwd', 'https-proxy',
    'https-proxy-user', 'https-proxy-passwd', 'referer', 'enable-http-keep-alive',
    'enable-http-pipelining', 'header', 'no-want-digest-header', 'save-cookies', 'use-head',
    'user-agent',
  ],
  'ftp-sftp': [
    'ftp-user', 'ftp-passwd', 'ftp-pasv', 'ftp-proxy', 'ftp-proxy-user', 'ftp-proxy-passwd',
    'ftp-reuse-connection', 'ftp-type', 'ssh-host-key-md',
  ],
  bt: [
    'bt-detach-seed-only', 'bt-enable-hook-after-hash-check', 'bt-enable-lpd', 'bt-exclude-tracker',
    'bt-external-ip', 'bt-force-encryption', 'bt-hash-check-seed', 'bt-load-saved-metadata',
    'bt-max-open-files', 'bt-max-peers',
    'bt-metadata-only', 'bt-min-crypto-level', 'bt-prioritize-piece', 'bt-remove-unselected-file',
    'bt-require-crypto', 'bt-request-peer-speed-limit', 'bt-save-metadata', 'bt-seed-unverified',
    'bt-stop-timeout', 'bt-tracker', 'bt-tracker-connect-timeout', 'bt-tracker-interval',
    'bt-tracker-timeout', 'dht-file-path', 'dht-file-path6', 'dht-listen-port', 'dht-message-timeout',
    'enable-dht', 'enable-dht6', 'enable-peer-exchange', 'follow-torrent', 'listen-port',
    'max-overall-upload-limit', 'max-upload-limit', 'peer-id-prefix', 'seed-ratio', 'seed-time',
  ],
  metalink: [
    'follow-metalink', 'metalink-base-uri', 'metalink-language', 'metalink-location', 'metalink-os',
    'metalink-version', 'metalink-preferred-protocol', 'metalink-enable-unique-protocol',
  ],
  rpc: [
    'enable-rpc', 'pause-metadata', 'rpc-allow-origin-all', 'rpc-listen-all', 'rpc-listen-port',
    'rpc-max-request-size', 'rpc-save-upload-metadata', 'rpc-secure',
  ],
  advanced: [
    'allow-overwrite', 'allow-piece-length-change', 'always-resume', 'async-dns', 'auto-file-renaming',
    'auto-save-interval', 'conditional-get', 'content-disposition-default-utf8', 'daemon',
    'deferred-input', 'disable-ipv6', 'disk-cache', 'download-result', 'dscp', 'enable-mmap',
    'file-allocation',
    'force-save', 'hash-check-only', 'human-readable', 'keep-unfinished-download-result',
    'max-download-limit', 'max-download-result', 'max-mmap-limit', 'max-overall-download-limit',
    'max-resume-failure-tries', 'min-tls-version', 'no-conf', 'no-file-allocation-limit',
    'optimize-concurrent-downloads', 'parameterized-uri', 'piece-length', 'quiet',
    'realtime-chunk-checksum', 'remove-control-file', 'save-session', 'save-session-interval',
    'save-not-found', 'socket-recv-buffer-size', 'stop', 'show-console-readout', 'summary-interval',
    'truncate-console-readout', 'console-log-level',
  ],
};

/** 快捷设置弹窗分组（footer 的全局限速入口用，暂供后续块） */
export const QUICK_SETTING_GROUPS = {
  globalSpeedLimitOptions: ['max-overall-download-limit', 'max-overall-upload-limit'],
};

/** 任务级选项（详情页设置 tab 用） */
export const TASK_OPTIONS = [
  { ...S('dir', { required: true }), category: 'task', showHistory: true, canUpdate: ['default', 'new', 'paused', 'error', 'complete', 'removed'] },
  { ...S('out'), category: 'task', canUpdate: ['default', 'new', 'paused', 'error', 'complete', 'removed'] },
  // 原先这里有一行 uri（aria-ng 遗留）：实测 aria2 的 changeOption({uri}) 回 "OK"
  // 但 aria2.getUris 前后完全不变，属于静默无效的写入。aria2 追加源地址走的是
  // aria2.addUri([gid], uris)（追加语义，不能整表替换），跟这行的编辑语义对不上，
  // 所以先撤掉这一行；任务的源地址在详情页的文件区照常显示。
  { ...N('split', { min: 1, max: 512 }), category: 'connection', canUpdate: ['default', 'new', 'paused', 'error', 'complete', 'removed'] },
  { ...N('max-connection-per-server', { min: 1, max: 16 }), category: 'connection', canUpdate: ['default', 'new', 'paused', 'error', 'complete', 'removed'] },
  { ...SZ('min-split-size'), category: 'connection', canUpdate: ['default', 'new', 'paused', 'error', 'complete', 'removed'] },
  { ...SZ('max-overall-download-limit'), category: 'limit' },
  { ...SZ('max-download-limit'), category: 'limit' },
  { ...SZ('max-overall-upload-limit'), category: 'limit' },
  { ...SZ('max-upload-limit'), category: 'limit' },
  { ...B('check-integrity'), category: 'advanced' },
  { ...B('continue'), category: 'advanced' },
  { ...B('dry-run'), category: 'advanced', canShow: ['default', 'new'] },
  { ...B('rpc-save-upload-metadata'), category: 'advanced', canShow: ['default', 'new'] },
  { ...B('pause'), category: 'advanced', canShow: ['default', 'new'], defaultValue: 'false' },
  { ...E('follow-torrent', [...YES_NO, 'mem']), category: 'bittorrent', canShow: ['default', 'new'] },
  { ...E('follow-metalink', [...YES_NO, 'mem']), category: 'metalink', canShow: ['default', 'new'] },
  { ...E('bt-prioritize-piece', ['head', 'tail', 'head,tail'], { submitFormat: 'string' }), category: 'bittorrent' },
  { ...B('bt-remove-unselected-file'), category: 'bittorrent' },
  { ...B('force-save'), category: 'bittorrent' },
  { ...T('header'), category: 'http' },
];
