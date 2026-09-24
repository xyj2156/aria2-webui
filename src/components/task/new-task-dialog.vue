<script setup>
/**
 * 新建下载任务弹窗（块 09）。三张列表页工具栏的「新建」按钮统一弹出本组件。
 *
 * 结构：上半「来源」两个 tab（链接 / BT种子），下半一条常驻「下载前配置」区，
 * 底部「开始下载 / 稍后下载 / 取消」动作条。稍后下载 = 给 options 加 pause=true，
 * 建到等待队列不立即开下。
 *
 * 数据流：链接逐行走 parseUrlsFromOriginInput（每行一个任务，走 invokeBatch 一次往返）；
 * 种子/磁链走原生 FileReader 读 base64，按扩展名分别调 addTorrent / addMetalink。
 * 配置区复用块 08 的 setting-item 引擎，初值回显 aria2 全局默认（use-global-options），
 * 但只把「用户实际改动过的键」收进 draftOptions 下发——留空的沿用全局、不静默塞给后端。
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useMessage } from 'naive-ui';
import { t } from '@/i18n/index.js';
import SettingItem from '@/components/setting/setting-item.vue';
import { useGlobalOptions } from '@/composables/use-global-options.js';
import { getNewTaskOptionKeys, getSpecifiedOptions } from '@/services/option-service.js';
import { detectUploadKind, MAX_UPLOAD_FILE_BYTES, readFileAsBase64 } from '@/services/file-service.js';
import { parseUrlsFromOriginInput } from '@/utils/url-parse.js';
import { addMetalinkTask, addTorrentTask, invokeBatch } from '@/rpc';

const props = defineProps({
  /** 显隐（配合 v-model:show） */
  show: { type: Boolean, default: false },
});

const emit = defineEmits(['update:show', 'refresh']);

const message = useMessage();
const global = useGlobalOptions();

/** 人类可读的体积上限，只用于超限文案（不引 format 工具，避免为一个提示拉整条链） */
const MAX_SIZE_LABEL = `${Math.round(MAX_UPLOAD_FILE_BYTES / (1024 * 1024))} MB`;
const ACCEPT_TYPES = '.torrent,.metalink,.meta4';

// =================================================================== 表单状态
const activeSource = ref('links'); // links | torrent
const linksText = ref('');
const upload = ref({ fileName: '', content: '', kind: '' }); // kind: torrent | metalink
const uploadError = ref('');
const draftOptions = reactive({}); // 仅存用户改动过的键
const submitting = ref(false);
const fileInputRef = ref(null);

const isTorrent = computed(() => activeSource.value === 'torrent');
const parsed = computed(() => parseUrlsFromOriginInput(linksText.value));
const canSubmit = computed(() => (isTorrent.value ? Boolean(upload.value.content) : parsed.value.urls.length > 0));

/** 配置项随来源变化：种子任务多带 BT 相关四项；disableRequired 让 dir 必填也不卡新建 */
const optionItems = computed(() => getSpecifiedOptions(getNewTaskOptionKeys(isTorrent.value), { disableRequired: true }));

// =================================================================== 配置区自适应高度
/**
 * 只有「下载前配置」区会超高（选项行数不固定），所以只让它内部滚，
 * 链接/种子输入区与 tab 标题始终完整可见、不滚不吸顶。
 * 弹窗封顶 68vh，量出「配置区以上已占的高度」后把余量分给配置区：
 *   放得下 → max-height 给到内容自然高（无滚动条、不裁切）；
 *   放不下 → max-height 收到余量、出滚动条。避免把输入区顶掉或凭空留白。
 */
const DIALOG_MAX_PX = () => Math.round(window.innerHeight * 0.68);
const bodyRef = ref(null);
const optionsRef = ref(null);
const optionsMaxHeight = ref('');

function measureOptionsHeight() {
  const body = bodyRef.value;
  const block = optionsRef.value;
  if (!body || !block) {
    return;
  }
  const beforeOptions = block.offsetTop - body.clientTop; // 配置块上方已占高度（tab 区 + 间距）
  const headH = block.querySelector('.options-head')?.offsetHeight ?? 0;
  const scrollEl = block.querySelector('.options-scroll');
  const naturalH = scrollEl ? scrollEl.scrollHeight : 0; // 滚动内容自然总高（不受 maxHeight 影响）
  const available = Math.max(120, DIALOG_MAX_PX() - beforeOptions - headH);
  // 只在内容超过弹窗余量时收缩出滚动条，否则按自然高、不留滚动条也不裁切
  optionsMaxHeight.value = `${Math.min(available, naturalH)}px`;
}

let resizeObserver = null;
function observeOptions() {
  resizeObserver?.disconnect();
  const scrollForm = optionsRef.value?.querySelector('.options-scroll form');
  if (typeof ResizeObserver !== 'undefined' && scrollForm) {
    // 观察滚动内容本体：它的自然高度随选项增减变化，且不受 maxHeight 收缩影响，无回环
    resizeObserver = new ResizeObserver(() => measureOptionsHeight());
    resizeObserver.observe(scrollForm);
  }
}

watch(
  () => props.show,
  async (visible) => {
    if (visible) {
      await nextTick();
      measureOptionsHeight();
      observeOptions();
    } else {
      resizeObserver?.disconnect();
      resizeObserver = null;
      optionsMaxHeight.value = '';
    }
  },
);

onBeforeUnmount(() => resizeObserver?.disconnect());

// =================================================================== 配置区（复用 setting-item）
/** 行内回执：option.key → SettingItem 实例（新建只收集本地值，改完即标成功） */
const itemRefs = new Map();
function setItemRef(el, key) {
  if (el) {
    itemRefs.set(key, el);
  } else {
    itemRefs.delete(key);
  }
}

function onOptionChange(payload) {
  const value = String(payload.value ?? '');
  if (value.trim()) {
    draftOptions[payload.key] = value;
  } else {
    delete draftOptions[payload.key];
  }
  // 本组件不发 RPC，把行内「保存中」图标就地收敛成成功，避免长转圈
  itemRefs.get(payload.key)?.reportResult(true);
}

/** 展示值：用户改过的优先，否则回显 aria2 全局默认 */
function optionValue(key) {
  return String(key in draftOptions ? draftOptions[key] : global.valueOf(key));
}

// =================================================================== 文件选择
function openFilePicker() {
  fileInputRef.value?.click();
}

async function onFileChange(event) {
  const file = event.target?.files?.[0];
  event.target.value = ''; // 允许再次选同一文件仍触发 change
  if (!file) {
    return;
  }

  const kind = detectUploadKind(file.name);
  if (!kind) {
    upload.value = { fileName: '', content: '', kind: '' };
    uploadError.value = t('task.new.torrent.unknown-type');
    return;
  }

  try {
    const { fileName, content } = await readFileAsBase64(file);
    upload.value = { fileName, content, kind };
    uploadError.value = '';
  } catch (e) {
    const code = e?.message || 'read-failed';
    upload.value = { fileName: '', content: '', kind: '' };
    uploadError.value = code === 'too-large'
      ? t('task.new.torrent.too-large', { size: MAX_SIZE_LABEL })
      : t(`task.new.torrent.${code === 'empty' ? 'empty' : code === 'no-file' ? 'no-file' : 'read-failed'}`);
  }
}

// =================================================================== 提交
async function submit(pause) {
  if (!canSubmit.value || submitting.value) {
    return;
  }
  submitting.value = true;

  const options = { ...draftOptions };
  if (pause) {
    options.pause = 'true';
  }

  try {
    if (isTorrent.value) {
      const { content, kind } = upload.value;
      if (kind === 'metalink') {
        await addMetalinkTask(content, [], options);
      } else {
        await addTorrentTask(content, [], options);
      }
      message.success(t('task.new.result.success', { count: 1 }));
    } else {
      const urls = parsed.value.urls;
      // 每行一个任务：一个 addUri 子调用，一次 multicall 往返全建完
      const results = await invokeBatch(urls.map((url) => ({ method: 'addUri', params: [[url], options] })));
      const failed = results.filter((row) => !row.ok);
      const ok = results.length - failed.length;
      if (failed.length) {
        const first = failed[0]?.error?.message || '';
        message.warning(`${t('task.new.result.success', { count: ok })}${first ? `（${first}）` : ''}`);
      } else {
        message.success(t('task.new.result.success', { count: ok }));
      }
    }
    emit('refresh');
    close();
  } catch (e) {
    message.error(t('task.new.result.failed', { message: e?.message || String(e) }));
  } finally {
    submitting.value = false;
  }
}

// =================================================================== 显隐与重置
function resetForm() {
  activeSource.value = 'links';
  linksText.value = '';
  upload.value = { fileName: '', content: '', kind: '' };
  uploadError.value = '';
  submitting.value = false;
  for (const key of Object.keys(draftOptions)) {
    delete draftOptions[key];
  }
  itemRefs.clear();
}

function close() {
  emit('update:show', false);
}

/** n-modal 内部（X / Esc）请求关闭时同步到父级 */
function onModalShow(visible) {
  if (!visible) {
    close();
  }
}

// 打开时拉一次全局选项做回显；关闭即重置，下次点开是干净表单。
watch(
  () => props.show,
  (visible) => {
    if (visible) {
      void global.load();
    } else {
      resetForm();
    }
  },
);
</script>

<template lang="pug">
n-modal(
  :show="props.show"
  preset="card"
  :mask-closable="false"
  :closable="true"
  :bordered="false"
  :title="t('task.new.title')"
  :style="{ width: '720px', maxWidth: '92vw' }"
  @update:show="onModalShow"
)
  .flex.flex-col.gap-4

    // ---------- 主体：封顶 68vh，只有里面的「下载前配置」区超高时自己滚 ----------
    // tab 标题 + 链接/种子输入区正常排布、完整可见；配置区用 flex 撑高并在其内部出滚动条
    .dialog-body(ref="bodyRef" :style="{ maxHeight: `${DIALOG_MAX_PX()}px` }")
      // ---------- 来源：链接 / BT种子 ----------
      n-tabs(v-model:value="activeSource" type="line")
        n-tab-pane(:tab="t('task.new.source.links')" name="links")
          n-input(
            type="textarea"
            :autosize="{ minRows: 6, maxRows: 12 }"
            :placeholder="t('task.new.links.placeholder')"
            v-model:value="linksText"
            @keydown.ctrl.enter="submit(false)"
          )
          .flex.gap-2.mt-1.text-xs.opacity-70
            span {{ t('task.new.links.valid-count', { count: parsed.urls.length }) }}
            span(v-if="parsed.ignored") {{ t('task.new.links.ignored-count', { count: parsed.ignored }) }}

        n-tab-pane(:tab="t('task.new.source.torrent')" name="torrent")
          input(
            ref="fileInputRef"
            type="file"
            :accept="ACCEPT_TYPES"
            style="display: none"
            @change="onFileChange"
          )
          .flex.items-center.gap-2
            n-input.flex-1(:value="upload.fileName" readonly :placeholder="t('task.new.torrent.none')")
            n-button(shrink-0 @click="openFilePicker") {{ t('task.new.torrent.pick') }}
          .text-xs.opacity-70.mt-1 {{ t('task.new.torrent.hint') }}
          .text-xs.mt-1(style="color: #d03050" v-if="uploadError") {{ uploadError }}

      // ---------- 下载前配置（唯一会滚的区） ----------
      .options-block(ref="optionsRef")
        .options-head
          .options-title {{ t('task.new.options.title') }}
          .options-hint {{ t('task.new.options.hint') }}
        .options-scroll(:style="optionsMaxHeight ? { maxHeight: optionsMaxHeight } : undefined")
          n-spin(:show="global.loading.value && !global.loaded.value")
            form
              setting-item(
                v-for="item in optionItems"
                :key="item.key"
                :ref="(el) => setItemRef(el, item.key)"
                :option="item"
                :model-value="optionValue(item.key)"
                disable-required
                @change="onOptionChange"
              )

    // ---------- 动作条 ----------
    .flex.items-center.gap-2.flex-shrink-0
      n-button(
        type="primary"
        :loading="submitting"
        :disabled="!canSubmit || submitting"
        @click="submit(false)"
      ) {{ t('task.new.action.download') }}
      n-button(
        :disabled="!canSubmit || submitting"
        @click="submit(true)"
      ) {{ t('task.new.action.download-later') }}
      .grow
      n-button(quaternary @click="close") {{ t('task.new.action.cancel') }}

</template>

<style scoped>
/* 主体：纵向排布，tab 区在上、配置区在下；总高由 :style 的 maxHeight(68vh) 封顶，
   放得下就自然高，放不下时把富余高度让给可收缩的配置区 */
.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
}
/* 配置区：flex 列，头部固定、下面滚动；overflow:hidden 只为了圆角裁切 */
.options-block {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  min-height: 0;
  border: 1px solid rgba(128, 128, 128, 0.16);
  border-radius: 6px;
  overflow: hidden;
}
.options-head {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(128, 128, 128, 0.06);
}
/* 唯一出滚动条的地方；max-height 由脚本按弹窗余量动态算，未超高时不设限、无滚动条 */
.options-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 2px 4px 2px 0;
}
.options-title {
  font-size: 13px;
  font-weight: 600;
}
.options-hint {
  font-size: 12px;
  opacity: 0.6;
}
</style>
