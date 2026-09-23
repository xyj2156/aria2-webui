/**
 * 英文文案。键结构必须与 zh-CN.js 完全一致，开发模式下引擎会自动比对并在控制台列出差异。
 * 只写值，不要重复写注释结构，避免两份语言包各自长歪。
 */
export default {
  app: {
    name: 'Aria2 WebUI',
  },
  lang: {
    label: 'Language',
  },
  theme: {
    toggle: 'Toggle theme',
  },
  menu: {
    group: {
      task: 'Tasks',
      system: 'System',
    },
    downloading: 'Downloading',
    waiting: 'Waiting',
    stopped: 'Stopped',
    settings: 'Settings',
  },
  connection: {
    status: {
      idle: 'Not connected',
      connecting: 'Connecting',
      connected: 'Connected',
      reconnecting: 'Reconnecting',
      error: 'Connection error',
    },
  },
};
