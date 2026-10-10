/**
 * 连接列表的显示顺序（一处实现、两处复用：顶栏切换器 + WebUI 设置的连接 tab）。
 *
 * 顺序由全局设置 rpcListDisplayOrder 驱动（单一事实源，改值即时生效）：
 *  - recentlyUsed：最近激活的在前，取 connections store 每条记录的 lastUsedAt；
 *                  从未激活过的（lastUsedAt = 0）自然垫底，同为 0 的按创建序（sort 稳定）
 *  - rpcAlias    ：按连接名字典序（数字感知、忽略大小写）
 *
 * 排序在副本上做，不碰 store 里的原始数组——connections 是 useStorage 持久化的，
 * 就地 sort 会连带改写 localStorage 里存的顺序，让「列表顺序」变成隐式的用户数据。
 *
 * 为什么不写成 connections store 的一个 getter：webui-settings.js 已经 import 了
 * connections store，反向再 import 它就是 ESM 循环。两边各自 import 本 composable，
 * 依赖方向保持单向（composable → store）。
 */
import { computed } from 'vue';

import { useConnectionStore } from '@/store/connections.js';
import { useWebuiSettingsStore } from '@/store/webui-settings.js';

/**
 * @returns {{ sortedConnections: import('vue').ComputedRef<import('@/store/connections.js').Connection[]> }}
 */
export function useSortedConnections() {
  const connections = useConnectionStore();
  const settings = useWebuiSettingsStore();

  const sortedConnections = computed(() => {
    const list = [...connections.connections];
    if (settings.options.rpcListDisplayOrder === 'rpcAlias') {
      return list.sort((a, b) =>
        String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, {
          numeric:     true,
          sensitivity: 'base',
        }),
      );
    }
    return list.sort((a, b) => (Number(b.lastUsedAt) || 0) - (Number(a.lastUsedAt) || 0));
  });

  return { sortedConnections };
}
