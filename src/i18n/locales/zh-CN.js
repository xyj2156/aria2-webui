export default {
  app: {
    name: 'Aria2 WebUI',
  },
  lang: {
    label: '语言',
  },
  theme: {
    toggle: '切换主题',
  },
  menu: {
    group: {
      task: '任务',
      system: '系统',
    },
    downloading: '下载中',
    waiting: '等待中',
    stopped: '已停止',
    settings: '设置',
  },
  connection: {
    // 键名与 rpc/constants.js 的 RPC_STATUS 取值一一对应：状态值直接拼进键名
    // （t(`connection.status.${status}`)），所以改那边的枚举必须同步改这里，
    // 漏了不会报错、只会把英文状态值显示给用户。
    status: {
      idle: '未连接',
      connecting: '连接中',
      connected: '已连接',
      reconnecting: '重连中',
      error: '连接异常',
    },
  },
};
