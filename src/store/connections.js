/**
 * aria2 连接配置仓库（Pinia Store）
 *
 * 管理所有 aria2 服务器的连接配置，支持增删改查与当前活跃连接的切换。
 * 所有数据通过 useStorage 持久化到 localStorage，刷新页面不丢失。
 *
 * 本文件的类型契约在文件顶部用 @typedef 声明，风格与 src/rpc/types.js 保持一致。
 *
 * 上层组件用法：
 *   import { useConnectionsStore } from '@/store/connections.js';
 *   const store = useConnectionsStore();
 *   store.addConnection({ name: '远程服务器', host: '192.168.1.100', port: 6800, protocol: 'http', secret: 'xxx' });
 */

// ═══════════════════════════════════════════════════════════════ 类型契约
// 这里只声明本 store 特有的类型；通用类型（RpcConfig / RpcProtocol 等）直接引用 src/rpc/types.js。

/**
 * 本 store 中一条完整的连接记录，在 RpcConfig 基础上附加了 UI 管理字段。
 * @typedef {import('../rpc/types.js').RpcConfig & {
 *   id:   string
 *   name: string
 * }} Connection
 */

/**
 * 用户新增或更新连接时传入的字段，全部可选。
 * @typedef {Partial<import('../rpc/types.js').RpcConfig & { name: string }>} ConnectionInput
 */

/**
 * addConnection 的返回值：成功时带 id，失败时带原因。
 * @typedef {{ ok: true; id: string } | { ok: false; reason: string }} AddResult
 */

// ═══════════════════════════════════════════════════════════════ 工具函数

/**
 * 生成一个简短唯一 ID，用于标识每条连接记录。
 * 使用 crypto.randomUUID() 截取前 8 位，足够在百条级别的连接列表中保证唯一。
 * @returns {string}
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * 创建一条带默认值 + 唯一 ID 的连接记录。
 * 未传入的字段会自动填充为 localhost 的默认配置。
 * @param {ConnectionInput} [overrides] 要覆盖的字段
 * @returns {Connection}
 */
function createConnection(overrides = {}) {
  return {
    id:       generateId(),
    name:     'localhost',
    host:     'localhost',
    port:     6800,
    path:     '/jsonrpc',
    protocol: 'http',
    secret:   '',
    ...overrides,
  };
}

export const useConnectionStore = defineStore('connections', function () {
  // =================================================================== 持久化状态
  /** @type {import('vue').Ref<Connection[]>} 所有连接配置列表，默认包含一条本地 localhost 连接 */
  const connections = useStorage('aria2-webui.connections', [
    createConnection({name: 'localhost', host: 'localhost'}),
  ]);

  /** @type {import('vue').Ref<string | null>} 当前正在使用的连接 ID，null 表示尚未选中任何连接 */
  const activeId = useStorage('aria2-webui.active-connection-id', null);
  // 初始化时，根据 activeId 检查是否存在对应的连接记录
  if (!activeId.value) {
    if (connections.value.length) {
      activeId.value = connections.value[0].id;
    }
    const con = getById(activeId.value);
    if (con) {
      setConnection(con);
    }
  }
  // =================================================================== 计算属性

  /** @type {import('vue').ComputedRef<Connection | null>} 当前活跃连接的完整配置对象 */
  const activeConnection = computed(() => {
    if (!activeId.value) {
      return connections.value.length > 0 ? connections.value[0] : null;
    }
    return connections.value.find((conn) => conn.id === activeId.value) || null;
  });

  /** @type {import('vue').ComputedRef<number>} 连接总数 */
  const count = computed(() => connections.value.length);

  // =================================================================== 连接管理方法

  /**
   * 添加一条新连接。
   * 自动检查是否与已有连接的主机地址完全重复（host + port + protocol + path 四元组）。
   * @param {ConnectionInput} connection 连接配置（缺省字段会用默认值填充）
   * @returns {AddResult} 添加结果
   */
  function addConnection(connection) {
    const newConn = createConnection(connection);

    connections.value.push(newConn);

    // 如果是第一条连接，自动设为活跃
    if (connections.value.length === 1) {
      activeId.value = newConn.id;
    }

    return {ok: true, id: newConn.id};
  }

  /**
   * 更新指定连接的部分字段。只更新传入的字段，未传入的保持不变。
   * @param {string} id 要更新的连接 ID
   * @param {ConnectionInput} partial 要更新的字段
   * @returns {boolean} 是否更新成功
   */
  function updateConnection(id, partial) {
    const index = connections.value.findIndex((conn) => conn.id === id);
    if (index === -1) {
      return false;
    }

    // 如果修改了地址信息，检查是否会与其它连接冲突
    const current = connections.value[index];
    const merged = {...current, ...partial};

    const duplicate = connections.value.find(
      (conn) =>
        conn.id !== id &&
        conn.protocol === merged.protocol &&
        conn.host === merged.host &&
        conn.port === merged.port &&
        conn.path === merged.path,
    );

    if (duplicate) {
      console.warn(`[connections] 更新后地址与 "${duplicate.name}" 冲突，跳过`);
      return false;
    }

    connections.value[index] = merged;
    return true;
  }

  /**
   * 删除一条连接。删除活跃连接时会自动切换到列表中的第一条。
   * @param {string | number} idOrIndex 连接 ID（字符串）或索引（数字）
   * @returns {boolean} 是否删除成功
   */
  function removeConnection(idOrIndex) {
    let index;

    if (typeof idOrIndex === 'number') {
      // 按索引删除
      index = idOrIndex;
    } else {
      // 按 ID 删除
      index = connections.value.findIndex((conn) => conn.id === idOrIndex);
    }

    if (index < 0 || index >= connections.value.length) {
      return false;
    }

    const removedId = connections.value[index].id;
    connections.value.splice(index, 1);

    // 如果删除的是当前活跃连接，自动切换到第一条（如果有的话）
    if (activeId.value === removedId) {
      activeId.value = connections.value.length > 0 ? connections.value[0].id : null;
    }

    return true;
  }

  /**
   * 清空所有连接配置，同步重置活跃连接 ID。
   */
  function clearConnections() {
    connections.value = [];
    activeId.value = null;
    setConnection({});
  }

  /**
   * 设置当前活跃连接。
   * @param {string} id 要激活的连接 ID
   * @returns {boolean} 是否设置成功（ID 不存在时返回 false）
   */
  function setActive(id) {
    const exists = connections.value.some((conn) => conn.id === id);
    if (!exists) {
      return false;
    }
    activeId.value = id;
    setConnection(getById(id));
    return true;
  }

  /**
   * 根据 ID 查找一条连接配置，找不到返回 undefined。
   * @param {string} id
   * @returns {Connection | undefined}
   */
  function getById(id) {
    return connections.value.find((conn) => conn.id === id);
  }

  return {
    // 状态
    connections,
    activeId,
    // 计算属性
    activeConnection,
    count,
    // 方法
    addConnection,
    updateConnection,
    removeConnection,
    clearConnections,
    setActive,
    getById,
  };
});