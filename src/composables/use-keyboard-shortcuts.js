/**
 * 全局键盘快捷键（消费 webui-settings 的 keyboardShortcuts 开关）。
 *
 * 结构对齐参考实现的 ariaNgKeyboardService：一个全局捕获阶段 keydown 监听 + 一张
 * 「页面级动作注册表」。监听只在壳层装一次；具体动作由各页面在挂载时注册、卸载时注销。
 *
 * 快捷键：
 *   Ctrl/Cmd + A  → selectAll（选中当前页所有任务）
 *   Ctrl/Cmd + F  → find（聚焦搜索框；即便焦点在文本框也响应，与参考一致）
 *   Delete        → delete（删除选中，受 confirmTaskRemoval 约束走各自实现）
 *
 * 门控与守卫：
 *   - keyboardShortcuts=false → 全部快捷键不响应；
 *   - 焦点在可编辑文本控件（input[type=text]/textarea）内时，跳过 selectAll / delete，
 *     以免打字误触发；find 不受此限。
 *   - Mac 用 metaKey，其余用 ctrlKey 作为主修饰键。
 */
import { onScopeDispose } from 'vue';

import { useWebuiSettingsStore } from '@/store/webui-settings.js';

/**
 * @typedef {'selectAll' | 'find' | 'delete'} KeyActionName
 * @typedef {(event: KeyboardEvent) => void} KeyAction
 */

/** 当前注册的动作表。 */
const keyActions = new Map();

/** 文本编辑目标标签集（焦点在其中时屏蔽 selectAll / delete）。 */
const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA']);

/**
 * 注册 / 注销一个页面级动作（action 传 null 即注销）。由页面在 setup 里调用。
 * @param {KeyActionName} name
 * @param {KeyAction | null} action
 */
export function setKeyAction(name, action) {
  if (action) {
    keyActions.set(name, action);
  } else {
    keyActions.delete(name);
  }
}

/** 撤下全部页面级动作（路由切换时可调用；本实现靠组件 onUnmounted 逐个注销，保留此 API 备用）。 */
export function clearPageKeyActions() {
  keyActions.delete('selectAll');
  keyActions.delete('delete');
}

/** 焦点是否落在可编辑文本控件里（input[type=text] / textarea / 其它可输入 input）。 */
function isTextEditingTarget(target) {
  if (!(target instanceof HTMLElement) || !TEXT_INPUT_TAGS.has(target.tagName)) {
    return false;
  }
  if (target instanceof HTMLInputElement) {
    return target.type === 'text';
  }
  return true;
}

let macPlatform = null;
function isMac() {
  if (macPlatform === null) {
    const nav = navigator;
    const platform = (nav.userAgentData && nav.userAgentData.platform) || nav.platform || '';
    macPlatform = /(Mac|iPhone|iPod|iPad)/i.test(platform);
  }
  return macPlatform;
}

/** Mac 用 metaKey，其余用 ctrlKey。 */
function isPrimaryModifierPressed(event) {
  return isMac() ? event.metaKey : event.ctrlKey;
}

function isSelectAllKey(event) {
  return isPrimaryModifierPressed(event) && event.code === 'KeyA';
}
function isFindKey(event) {
  return isPrimaryModifierPressed(event) && event.code === 'KeyF';
}
function isDeleteKey(event) {
  return event.code === 'Delete';
}

/** 全局 keydown 处理（捕获阶段）。每次都实时读设置开关，改设置即时生效。 */
function handleGlobalKeyDown(event) {
  const settings = useWebuiSettingsStore();
  if (!settings.options.keyboardShortcuts) {
    return;
  }

  if (isFindKey(event)) {
    const find = keyActions.get('find');
    if (find) {
      event.preventDefault();
      find(event);
    }
    return;
  }

  // 打字时不误触 selectAll / delete
  if (isTextEditingTarget(event.target)) {
    return;
  }

  if (isSelectAllKey(event)) {
    const selectAll = keyActions.get('selectAll');
    if (selectAll) {
      event.preventDefault();
      selectAll(event);
    }
  } else if (isDeleteKey(event)) {
    keyActions.get('delete')?.(event);
  }
}

let installed = false;

/**
 * 装载全局键盘快捷键监听。应在应用壳层 setup 里调用一次；作用域销毁时自动解绑。
 * 幂等：重复调用不会挂多个监听。
 */
export function useKeyboardShortcuts() {
  if (installed) {
    return;
  }
  installed = true;
  // 捕获阶段：与参考一致，页面自己 stopPropagation 才能屏蔽全局动作
  window.addEventListener('keydown', handleGlobalKeyDown, true);
  onScopeDispose(() => {
    window.removeEventListener('keydown', handleGlobalKeyDown, true);
    installed = false;
  });
}
