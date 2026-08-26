<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { Drawer, Input, Button, Alert, Spin } from 'ant-design-vue'
import { Terminal, Play, Trash2, X } from 'lucide-vue-next'
import { runCommand } from '../../api/agent.js'
import { settings } from '../../settings.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  projectId: { type: String, default: '' },
})
const emit = defineEmits(['update:open'])

const command = ref('')
const history = ref([])
const running = ref(false)
const outputRef = ref(null)

const permission = computed(() => settings.permission || 'full')
const disabled = computed(() => permission.value === 'read-only' || permission.value === 'none')

async function onRun() {
  const cmd = command.value.trim()
  if (!cmd || running.value || disabled.value) return
  running.value = true
  const item = { cmd, stdout: '', stderr: '', code: null, timedOut: false, error: '' }
  history.value.push(item)
  scrollToBottom()
  try {
    const res = await runCommand({
      command: cmd,
      projectId: props.projectId,
      permission: permission.value,
      timeout: settings.commandTimeout,
    })
    item.stdout = res.stdout || ''
    item.stderr = res.stderr || ''
    item.code = res.code
    item.timedOut = !!res.timedOut
  } catch (e) {
    item.error = String(e.message || e)
  } finally {
    running.value = false
    command.value = ''
    scrollToBottom()
  }
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    onRun()
  }
}

function clearHistory() {
  history.value = []
}

function scrollToBottom() {
  nextTick(() => {
    const el = outputRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(() => props.open, (v) => {
  if (v) scrollToBottom()
})
</script>

<template>
  <Drawer
    :open="open"
    :width="640"
    :closable="false"
    placement="right"
    @update:open="(v) => emit('update:open', v)"
  >
    <template #title>
      <div class="terminal-drawer__title">
        <Terminal :size="16" />
        <span>本机终端</span>
      </div>
    </template>
    <template #extra>
      <button class="terminal-drawer__close" @click="emit('update:open', false)">
        <X :size="16" />
      </button>
    </template>

    <Alert
      v-if="disabled"
      type="warning"
      show-icon
      :message="`当前为 ${permission} 模式，无法执行命令。请到设置切换为「完全访问」。`"
      class="terminal-drawer__warn"
    />

    <div ref="outputRef" class="terminal-drawer__output">
      <div v-if="history.length === 0" class="terminal-drawer__empty">
        在下方输入命令，按 Enter 执行。命令在当前项目目录下运行。
      </div>
      <div v-for="(h, i) in history" :key="i" class="terminal-drawer__item">
        <div class="terminal-drawer__cmd">
          <span class="terminal-drawer__prompt">$</span>
          <span>{{ h.cmd }}</span>
        </div>
        <pre v-if="h.stdout" class="terminal-drawer__stdout">{{ h.stdout }}</pre>
        <pre v-if="h.stderr" class="terminal-drawer__stderr">{{ h.stderr }}</pre>
        <div v-if="h.error" class="terminal-drawer__error">{{ h.error }}</div>
        <div v-else-if="h.code !== null" class="terminal-drawer__code" :class="{ 'terminal-drawer__code--fail': h.code !== 0 }">
          [退出码 {{ h.code }}<span v-if="h.timedOut">，超时</span>]
        </div>
      </div>
      <div v-if="running" class="terminal-drawer__running">
        <Spin size="small" />
        <span>执行中...</span>
      </div>
    </div>

    <div class="terminal-drawer__foot">
      <Input
        v-model:value="command"
        :disabled="disabled || running"
        placeholder="输入命令..."
        class="terminal-drawer__input"
        @keydown="onKeydown"
      >
        <template #addonAfter>
          <Button
            type="primary"
            size="small"
            :disabled="disabled || running || !command.trim()"
            @click="onRun"
          >
            <template #icon><Play :size="12" /></template>
            运行
          </Button>
        </template>
      </Input>
      <Button
        type="default"
        size="small"
        :disabled="history.length === 0"
        @click="clearHistory"
      >
        <template #icon><Trash2 :size="12" /></template>
        清屏
      </Button>
    </div>
  </Drawer>
</template>

<style scoped lang="less">
.terminal-drawer__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--color-text-strong);
}
.terminal-drawer__close {
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
.terminal-drawer__close:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}
.terminal-drawer__warn {
  margin-bottom: 12px;
}
.terminal-drawer__output {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--code-block-bg);
  color: var(--code-block-text);
  padding: 12px;
  font-family: 'Fira Code', Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.6;
}
.terminal-drawer__empty {
  color: var(--color-text-muted);
  opacity: 0.7;
}
.terminal-drawer__item {
  margin-bottom: 12px;
}
.terminal-drawer__cmd {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-primary);
  font-weight: 600;
  margin-bottom: 4px;
}
.terminal-drawer__prompt {
  opacity: 0.8;
}
.terminal-drawer__stdout,
.terminal-drawer__stderr {
  margin: 0;
  padding: 6px 8px;
  white-space: pre-wrap;
  word-break: break-all;
  border-radius: 4px;
}
.terminal-drawer__stdout {
  color: var(--code-block-text);
}
.terminal-drawer__stderr {
  color: var(--color-danger);
  background: var(--color-danger-bg);
}
.terminal-drawer__error {
  color: var(--color-danger);
  padding: 4px 8px;
  background: var(--color-danger-bg);
  border-radius: 4px;
}
.terminal-drawer__code {
  color: var(--color-success);
  font-size: 11px;
  margin-top: 2px;
}
.terminal-drawer__code--fail {
  color: var(--color-danger);
}
.terminal-drawer__running {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-muted);
  font-size: 12px;
}
.terminal-drawer__foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.terminal-drawer__input {
  flex: 1;
}
.terminal-drawer__input :deep(input) {
  font-family: 'Fira Code', Consolas, monospace;
}
</style>
