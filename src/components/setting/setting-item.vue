<script setup>
/**
 * 一行设置 = 一个类型化控件（块 08 §3，替代旧 ng-setting 指令，端口自 project 的 SettingItem）。
 *
 * 状态机 ready → pending → saving → success / failed / error；校验不过时置 error 且不发写请求
 * （拦截而不是静默），值变化按 lazySaveTimeout 去抖后经 change 事件交给父层写入，父层 RPC 回执
 * 再调 reportResult(success, message) 回写行内状态。
 *
 * 控件按 option.type 选择：text→多行、boolean/option→下拉、其余→输入框。
 * 说明：project 的「设置历史自动补全」依赖 storage + 历史服务（块 08 未含），此处降级为普通输入。
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import {
  AlertCircleOutline,
  CheckmarkCircleOutline,
  HelpCircleOutline,
  StarOutline,
  SyncOutline,
  TimeOutline,
} from '@vicons/ionicons5';
import { t } from '@/i18n/index.js';

const props = defineProps({
  option: { type: Object, required: true },
  modelValue: { type: String, default: '' },
  /** append 模式下强制展示的全局值（只读） */
  fixedValue: { type: String, default: '' },
  lazySaveTimeout: { type: Number, default: 500 },
  disableRequired: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'change']);

const draft = ref(props.modelValue ?? '');
const status = ref('ready');
const errorText = ref('');
let saveTimer = null;

// 外部（初始化、重置）改值时不打断本地编辑态
watch(
  () => props.modelValue,
  (value) => {
    if (value === draft.value) {
      return;
    }
    draft.value = value ?? '';
    clearTimer();
    setStatus('ready');
  },
);

/** 名称：优先译文，缺译文时回落成 aria2 选项名，避免出现 'options.xxx.name' 字面量 */
const nameLabel = computed(() => {
  const text = t(props.option.nameKey);
  return text === props.option.nameKey ? `--${props.option.key}` : text;
});
const hasDescription = computed(() => {
  const text = t(props.option.descriptionKey);
  return text !== props.option.descriptionKey;
});
const descriptionText = computed(() => t(props.option.descriptionKey));

const controlKind = computed(() => {
  const type = props.option.type;
  if (type === 'text') {
    return 'text';
  }
  if (type === 'boolean' || type === 'option') {
    return 'select';
  }
  return 'input';
});

function choiceLabel(value) {
  if (value === 'true') {
    return t('option.true');
  }
  if (value === 'false') {
    return t('option.false');
  }
  return value;
}
const choices = computed(() => (props.option.options ?? []).map((value) => ({ label: choiceLabel(value), value })));

const SUFFIX_TEXT = { Bytes: 'B', Milliseconds: 'ms', Seconds: 's', Minutes: 'min', Hours: 'h' };
const suffixText = computed(() => (props.option.suffix ? SUFFIX_TEXT[props.option.suffix] ?? '' : ''));

const itemCountText = computed(() => {
  if (props.option.type !== 'text' || !props.option.showCount) {
    return '';
  }
  const separator = props.option.separator ?? '\n';
  const parts = String(draft.value ?? '').split(separator);
  const counted = props.option.trimCount ? parts.filter((part) => part.trim()) : parts.filter((part) => part.length > 0);
  return t('format.settings.total-count', { count: counted.length });
});

const statusIcon = computed(() => {
  switch (status.value) {
    case 'pending':
      return TimeOutline;
    case 'saving':
      return SyncOutline;
    case 'success':
      return CheckmarkCircleOutline;
    case 'failed':
    case 'error':
      return AlertCircleOutline;
    default:
      return StarOutline;
  }
});
const statusColor = computed(() => {
  switch (status.value) {
    case 'saving':
      return '#2080f0';
    case 'success':
      return '#18a058';
    case 'failed':
      return '#f0a020';
    case 'error':
      return '#d03050';
    default:
      return 'rgba(128,128,128,0.5)';
  }
});

function setStatus(next, message = '') {
  status.value = next;
  errorText.value = message;
}

/** 校验链（required → integer → float → min/max → pattern），失败即拦截保存 */
function validate(value) {
  const option = props.option;
  const text = String(value ?? '');

  if (option.required && !props.disableRequired && !text.trim()) {
    return t('setting.validate.empty');
  }
  if (!text.trim() && !option.required) {
    return null;
  }
  if (option.type === 'integer' && !/^-?\d+$/.test(text.trim())) {
    return t('setting.validate.invalid-number');
  }
  if (option.type === 'float' && !/^-?(\d*\.)?\d+$/.test(text.trim())) {
    return t('setting.validate.invalid-number');
  }
  const numeric = Number(text.trim());
  if (Number.isFinite(numeric) && option.type !== 'text') {
    if (option.min !== undefined && numeric < option.min) {
      return t('setting.validate.below-min', { value: option.min });
    }
    if (option.max !== undefined && numeric > option.max) {
      return t('setting.validate.above-max', { value: option.max });
    }
  }
  if (option.pattern && !new RegExp(option.pattern).test(text)) {
    return t('setting.validate.invalid');
  }
  return null;
}

function clearTimer() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

function commit(value) {
  clearTimer();
  const invalid = validate(value);
  if (invalid) {
    setStatus('error', invalid);
    return;
  }
  setStatus('saving');
  emit('update:modelValue', value);
  emit('change', { key: props.option.key, value, status: 'saving' });
}

function scheduleCommit() {
  clearTimer();
  setStatus('pending');
  saveTimer = setTimeout(() => commit(draft.value), props.lazySaveTimeout);
}

function setDraft(value) {
  draft.value = value === null || value === undefined ? '' : String(value);
}

function onInput() {
  scheduleCommit();
}
function onBlur() {
  if (status.value === 'pending') {
    scheduleCommit();
  }
}
function onSelectChange(value) {
  setDraft(value);
  commit(String(value));
}

/** 供父层在 RPC 回执后回写行内状态 */
function reportResult(success, message = '') {
  clearTimer();
  setStatus(success ? 'success' : 'failed', message);
}

onUnmounted(clearTimer);
defineExpose({ reportResult, status });
</script>

<template lang="pug">
.form-row
  .form-row__label
    .label-line
      span.label-name {{ nameLabel }}
      span.required-mark(v-if="option.required && !disableRequired") *
      span.label-key ({{ option.key }})
      n-tooltip.plain(v-if="hasDescription" trigger="hover" :show-arrow="false")
        template(#trigger)
          n-icon(:component="HelpCircleOutline" :size="14")
        .desc-tip {{ descriptionText }}
      span.label-since(v-if="option.since") {{ option.since }}

  .form-row__control
    pre.fixed-value(v-if="fixedValue") {{ fixedValue }}

    template(v-else)
      n-input.text-control(
        v-if="controlKind === 'text'"
        type="textarea"
        :rows="6"
        :value="draft"
        @update:value="(v) => { setDraft(v); onInput(); }"
      )
      span.count-hint(v-if="controlKind === 'text' && itemCountText") {{ itemCountText }}

      n-select.select-control(
        v-else-if="controlKind === 'select'"
        size="small"
        :value="draft"
        :options="choices"
        @update:value="onSelectChange"
      )

      n-input.input-control(
        v-else
        size="small"
        :value="draft"
        :inputmode="option.type === 'integer' || option.type === 'float' ? 'decimal' : 'text'"
        @update:value="(v) => { setDraft(v); onInput(); }"
        @blur="onBlur"
      )

      span.suffix-hint(v-if="option.suffix && controlKind !== 'select'") {{ suffixText }}

    n-tooltip(v-if="errorText && (status === 'error' || status === 'failed')" trigger="hover" :show-arrow="false")
      template(#trigger)
        n-icon.status-icon(:component="statusIcon" :size="16" :style="{ color: statusColor }")
      | {{ errorText }}
    n-icon.status-icon(v-else :component="statusIcon" :size="16" :style="{ color: statusColor }")
</template>

<style scoped>
.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
}
.form-row__label {
  width: 240px;
  flex-shrink: 0;
}
.label-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.label-name {
  font-size: 13px;
  font-weight: 600;
}
.required-mark {
  color: #d03050;
}
.label-key,
.label-since {
  font-size: 12px;
  opacity: 0.55;
}
.plain {
  display: inline-flex;
  cursor: help;
}
.desc-tip {
  max-width: 320px;
  font-size: 12px;
  line-height: 1.5;
}
.form-row__control {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  flex-wrap: wrap;
}
.input-control {
  max-width: 320px;
}
.select-control {
  width: 160px;
}
.text-control {
  flex: 1;
  min-width: 240px;
}
.count-hint,
.suffix-hint {
  font-size: 12px;
  opacity: 0.6;
}
.fixed-value {
  margin: 0;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 12px;
  background: rgba(128, 128, 128, 0.1);
}
.status-icon {
  flex-shrink: 0;
}
</style>
