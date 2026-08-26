<script setup>
import { ref, computed, watch } from 'vue'
import { Drawer, Button, Select, Alert, Spin } from 'ant-design-vue'
import { FileEdit, Folder, FileText, ChevronRight, X, ExternalLink, FolderOpen } from 'lucide-vue-next'
import { listDir, openInEditor, fetchEditors } from '../../api/agent.js'
import { settings } from '../../settings.js'
import { message } from 'ant-design-vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  projectId: { type: String, default: '' },
})
const emit = defineEmits(['update:open'])

// 编辑器下拉：默认「系统默认程序」+ 运行时扫描到的本机编辑器（非写死）
const editorOptions = ref([{ value: 'default', label: '系统默认程序' }])
const selectedEditor = ref('default')
const currentPath = ref('')
const items = ref([])
const loading = ref(false)
const disabled = computed(() => {
  const p = settings.permission || 'full'
  return p === 'read-only' || p === 'none'
})
// 未选中项目时，目录会回退到用户主目录，此时打开目录无意义且容易误操作
const noProject = computed(() => !props.projectId)

async function loadEditors() {
  try {
    const data = await fetchEditors()
    const scanned = (data.editors || []).map((e) => ({ value: e.value, label: e.label }))
    editorOptions.value = [{ value: 'default', label: data.defaultLabel || '系统默认程序' }, ...scanned]
  } catch {
    // 扫描失败则保留默认项，不影响打开功能
  }
}

async function loadDir(rel = '') {
  loading.value = true
  try {
    const data = await listDir({ rel, projectId: props.projectId })
    currentPath.value = data.path || ''
    items.value = data.items || []
  } catch (e) {
    message.error(String(e.message || e))
  } finally {
    loading.value = false
  }
}

function enterDir(name) {
  const next = currentPath.value ? currentPath.value + '/' + name : name
  loadDir(next)
}

function goUp() {
  if (!currentPath.value) return
  const parts = currentPath.value.split('/')
  parts.pop()
  loadDir(parts.join('/'))
}

function goRoot() {
  loadDir('')
}

async function openFile(item) {
  if (disabled.value) return
  if (item.type === 'dir') {
    enterDir(item.name)
    return
  }
  try {
    await openInEditor({
      filePath: item.path,
      editor: selectedEditor.value,
      projectId: props.projectId,
      permission: settings.permission,
    })
    message.success('已唤起编辑器')
  } catch (e) {
    message.error(String(e.message || e))
  }
}

// 用本机编辑器打开整个目录（根目录或当前所在文件夹）
async function openDir(relPath = '') {
  if (disabled.value || noProject.value) return
  try {
    await openInEditor({
      filePath: relPath,
      editor: selectedEditor.value,
      projectId: props.projectId,
      permission: settings.permission,
    })
    message.success('已唤起编辑器打开目录')
  } catch (e) {
    message.error(String(e.message || e))
  }
}

watch(() => props.open, (v) => {
  if (v) {
    loadDir('')
    loadEditors()
  }
})
</script>

<template>
  <Drawer
    :open="open"
    :width="520"
    :closable="false"
    placement="right"
    @update:open="(v) => emit('update:open', v)"
  >
    <template #title>
      <div class="editor-drawer__title">
        <FileEdit :size="16" />
        <span>本机编辑器</span>
      </div>
    </template>
    <template #extra>
      <button class="editor-drawer__close" @click="emit('update:open', false)">
        <X :size="16" />
      </button>
    </template>

    <Alert
      v-if="disabled"
      type="warning"
      show-icon
      :message="`当前为 ${settings.permission} 模式，无法通过编辑器打开文件。请到设置切换为「完全访问」。`"
      class="editor-drawer__warn"
    />
    <Alert
      v-else-if="noProject"
      type="warning"
      show-icon
      message="未选中项目目录，打开目录将回退到用户主目录。请先在左上角选择一个项目。"
      class="editor-drawer__warn"
    />

    <div class="editor-drawer__bar">
      <div class="editor-drawer__crumb">
        <button class="editor-drawer__crumb-item" @click="goRoot">根目录</button>
        <template v-if="currentPath">
          <ChevronRight :size="12" />
          <span class="editor-drawer__crumb-item editor-drawer__crumb-item--active">{{ currentPath }}</span>
        </template>
      </div>
      <div class="editor-drawer__bar-right">
        <Button
          size="small"
          type="primary"
          :disabled="disabled || noProject"
          class="editor-drawer__open-dir"
          @click="openDir(currentPath)"
        >
          <template #icon><FolderOpen :size="12" /></template>
          打开{{ currentPath ? '当前目录' : '根目录' }}
        </Button>
        <Select
          v-model:value="selectedEditor"
          :options="editorOptions"
          size="small"
          class="editor-drawer__select"
        />
      </div>
    </div>

    <div class="editor-drawer__list">
      <Spin v-if="loading" size="small" />
      <div v-else>
        <div v-if="currentPath" class="editor-drawer__row" @click="goUp">
          <Folder :size="14" />
          <span>..</span>
        </div>
        <div
          v-for="item in items"
          :key="item.path"
          class="editor-drawer__row"
          :class="{ 'editor-drawer__row--file': item.type === 'file' }"
          @click="openFile(item)"
        >
          <Folder v-if="item.type === 'dir'" :size="14" class="editor-drawer__icon--dir" />
          <FileText v-else :size="14" class="editor-drawer__icon--file" />
          <span class="editor-drawer__name">{{ item.name }}</span>
          <Button
            v-if="item.type === 'dir'"
            type="text"
            size="small"
            class="editor-drawer__open"
            :disabled="disabled || noProject"
            title="用编辑器打开此目录"
            @click.stop="openDir(item.path)"
          >
            <template #icon><FolderOpen :size="12" /></template>
            打开目录
          </Button>
          <Button
            v-else
            type="text"
            size="small"
            class="editor-drawer__open"
            :disabled="disabled"
            @click.stop="openFile(item)"
          >
            <template #icon><ExternalLink :size="12" /></template>
            打开
          </Button>
        </div>
        <div v-if="items.length === 0 && !currentPath" class="editor-drawer__empty">
          目录为空
        </div>
      </div>
    </div>
  </Drawer>
</template>

<style scoped lang="less">
.editor-drawer__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--color-text-strong);
}
.editor-drawer__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.editor-drawer__close:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}
.editor-drawer__warn {
  margin-bottom: 12px;
}
.editor-drawer__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.editor-drawer__bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.editor-drawer__open-dir {
  flex-shrink: 0;
}
.editor-drawer__crumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-muted);
  overflow: hidden;
}
.editor-drawer__crumb-item {
  background: transparent;
  border: none;
  padding: 0;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 12px;
}
.editor-drawer__crumb-item:hover {
  text-decoration: underline;
}
.editor-drawer__crumb-item--active {
  color: var(--color-text);
  cursor: default;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editor-drawer__select {
  width: 130px;
  flex-shrink: 0;
}
.editor-drawer__list {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  min-height: 200px;
  padding: 6px 0;
  background: var(--color-bg);
}
.editor-drawer__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  transition: background 0.1s;
}
.editor-drawer__row:hover {
  background: var(--color-bg-subtle);
}
.editor-drawer__row--file {
  cursor: default;
}
.editor-drawer__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editor-drawer__icon--dir {
  color: var(--color-primary);
  flex-shrink: 0;
}
.editor-drawer__icon--file {
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.editor-drawer__open {
  opacity: 0;
  flex-shrink: 0;
}
.editor-drawer__row:hover .editor-drawer__open {
  opacity: 1;
}
.editor-drawer__empty {
  padding: 24px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 13px;
}
</style>
