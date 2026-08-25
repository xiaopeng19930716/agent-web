<script setup>
import { reactive, ref, computed } from 'vue'
import { addProject } from '../../projects.js'

const props = defineProps({
  show: { type: Boolean, default: false },
  dirPickerSupported: { type: Boolean, default: false },
  dirPickerHint: { type: String, default: '' },
})
const emit = defineEmits(['update:show', 'confirm'])

const form = reactive({ alias: '', path: '', displayName: '', needsManualPath: false })
const formError = ref('')
const canConfirm = computed(() => !!form.alias.trim() && !!form.path.trim())

function reset() {
  form.alias = ''
  form.path = ''
  form.displayName = ''
  form.needsManualPath = false
  formError.value = ''
}

async function pickDirectory() {
  if (!props.dirPickerSupported) return
  try {
    const handle = await window.showDirectoryPicker()
    const dirName = handle.name
    formError.value = '正在定位目录…'
    const relSegments = []
    let hasHiddenSeg = dirName.startsWith('.')
    let cur = handle
    try {
      while (cur && typeof cur.getParent === 'function') {
        const parent = await cur.getParent()
        if (!parent || !parent.name) break
        if (parent.name.startsWith('.')) hasHiddenSeg = true
        relSegments.unshift(parent.name)
        if (relSegments.length >= 10) break
        cur = parent
      }
    } catch {
      // getParent 不可用或权限受限，走名称搜索兜底
    }
    const rel = relSegments.join('/')
    form.displayName = rel ? rel + '/' + dirName : dirName
    try {
      const params = new URLSearchParams({ name: dirName })
      if (rel) params.set('path', rel + '/' + dirName)
      const resp = await fetch('/api/locate-dir?' + params.toString())
      if (resp.ok) {
        const data = await resp.json()
        if (data.path) {
          form.path = data.path
          form.displayName = data.path
          formError.value = ''
          return
        }
        if (data.results && data.results.length) {
          form.path = data.results[0]
          form.displayName = data.results[0]
          formError.value = ''
          return
        }
        if (data.hint) {
          // 定位失败：不预填仅含目录名的相对路径，留空让用户直接粘贴真实绝对路径
          form.path = ''
          form.displayName = ''
          form.needsManualPath = true
          formError.value = data.hint
          return
        }
      }
    } catch {
      // 定位失败，回退到手动输入
    }
    // 定位失败：不预填相对路径，留空让用户直接粘贴真实绝对路径
    form.path = ''
    form.displayName = ''
    form.needsManualPath = true
    formError.value = hasHiddenSeg
      ? '检测到该目录位于隐藏目录（. 开头）下，浏览器无法自动定位完整路径，请点击输入框手动粘贴绝对路径（如 C:/Users/你的用户名/.config/opencode/skills）'
      : '未能自动定位到完整路径，请在输入框手动补全绝对路径（如 C:/Users/.../' + dirName + '）'
  } catch (e) {
    // 用户取消选择
  }
}

// 兜底情况下允许用户在输入框手动补全绝对路径
// 注意：不能把 needsManualPath 置 false，否则 path 非空时 readonly 会立即锁死输入框，导致无法连续删除
function onPathInput(e) {
  form.displayName = e.target.value
  form.path = e.target.value
  form.needsManualPath = true
}

// 点击已自动定位的输入框时解锁为可编辑，允许用户手动修正/清空路径
function unlockEdit() {
  if (form.path && !form.needsManualPath) {
    form.needsManualPath = true
  }
}

async function confirmAdd() {
  if (!form.alias.trim() || !form.displayName.trim()) {
    formError.value = '别名和目录路径不能为空'
    return
  }
  try {
    const p = await addProject({
      alias: form.alias.trim(),
      path: form.displayName.trim(),
    })
    emit('confirm', p)
    emit('update:show', false)
    reset()
  } catch (e) {
    formError.value = e.message
  }
}

function cancel() {
  emit('update:show', false)
  reset()
}
</script>

<template>
  <div v-if="show" class="modal-mask" @click.self="cancel">
    <div class="modal">
      <h3>添加项目</h3>
      <label class="field">
        <span>别名（显示用）</span>
        <input v-model="form.alias" placeholder="如：我的前端项目" />
      </label>
      <label class="field">
        <span>项目目录</span>
        <div class="field-row">
          <input
            :value="form.displayName"
            :readonly="!!form.path && !form.needsManualPath"
            :class="{ 'input--readonly': !!form.path && !form.needsManualPath }"
            :title="form.path"
            :placeholder="form.needsManualPath ? '请粘贴完整绝对路径，如 C:/Users/你的用户名/.config/opencode/skills' : '请点击右侧按钮选择目录'"
            @input="onPathInput"
            @click="unlockEdit"
          />
          <button
            type="button"
            class="btn btn--ghost"
            :disabled="!dirPickerSupported"
            :title="dirPickerHint"
            @click="pickDirectory"
          >
            选择文件夹
          </button>
        </div>
        <small class="field__hint">{{ dirPickerHint }}</small>
      </label>
      <small v-if="formError" class="model-add__error">{{ formError }}</small>
      <div class="modal__actions">
        <button class="btn" @click="cancel">取消</button>
        <button class="btn btn--primary" :disabled="!canConfirm" @click="confirmAdd">添加</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  background: #fff;
  border-radius: 14px;
  padding: 24px;
  width: 440px;
  max-width: 92vw;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
}
.modal h3 {
  margin: 0 0 16px;
  font-size: 18px;
  color: #1f2937;
}
.modal .field {
  display: block;
  margin-bottom: 14px;
}
.modal .field-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.modal .field-row input {
  flex: 1;
}
.modal .field-row input[readonly] {
  background: #f8fafc;
  color: #475569;
  cursor: default;
}
.modal .field__hint {
  display: block;
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
}
.modal .field > span {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
  color: #374151;
}
.modal .field input,
.modal .field select {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
}
.modal .field input:focus,
.modal .field select:focus {
  border-color: #2563eb;
}
.modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}
.btn {
  padding: 9px 18px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  font-size: 14px;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn--ghost {
  background: #f1f5f9;
  color: #1f2937;
}
.btn--ghost:hover:not(:disabled) {
  background: #e2e8f0;
}
.btn--primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.model-add__error {
  color: #dc2626;
  font-size: 12px;
}
</style>
