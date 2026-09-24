/**
 * aria2 全局选项读写 composable（块 08）。模块级单例状态：全局设置页与
 * 详情页共享同一份已加载选项，避免重复拉。所有网络只经 @/rpc。
 *
 * - load(force)：getAria2Options 拉全量，缓存到 values
 * - valueOf(key)：取某键当前值（字符串）
 * - write(key, value)：changeGlobalOption 写回，成功即更新本地值；返回 {ok, message}
 */
import { computed, ref } from 'vue';
import { getAria2Options, saveAria2Options } from '@/rpc';

const values = ref({});
const loading = ref(false);
const loaded = ref(false);
let inflight = null;

async function load(force = false) {
  if (!force && loaded.value) {
    return values.value;
  }
  if (inflight) {
    return inflight;
  }
  loading.value = true;
  inflight = (async () => {
    try {
      values.value = await getAria2Options();
      loaded.value = true;
    } finally {
      loading.value = false;
      inflight = null;
    }
  })();
  return inflight;
}

function valueOf(key) {
  const value = values.value?.[key];
  return value === undefined || value === null ? '' : String(value);
}

/**
 * 写一个键。
 * @param {string} key
 * @param {string|string[]} value
 * @returns {Promise<{ok: boolean, message?: string}>}
 */
async function write(key, value) {
  try {
    await saveAria2Options({ [key]: value });
    values.value = { ...values.value, [key]: value };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e?.message || String(e) };
  }
}

export function useGlobalOptions() {
  return {
    values: computed(() => values.value),
    loading,
    loaded,
    load,
    valueOf,
    write,
  };
}
