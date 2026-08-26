<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { Drawer, Input, Button, Alert, Spin, Modal, Select } from 'ant-design-vue'
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
// 输出区高度（可拖动调整，仅本次生效）
const outputHeight = ref('16rem')
// 执行命令的 shell 选择（仅本次生效，不持久化）
const isWin = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform || navigator.userAgent)
const shellOptions = isWin
  ? [
      { value: 'powershell', label: 'PowerShell' },
      { value: 'cmd', label: '命令提示符' },
    ]
  : [{ value: 'sh', label: '终端 (sh)' }]
const selectedShell = ref(shellOptions[0].value)

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
      shell: selectedShell.value,
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

// 快捷命令：点击即执行（按钮显示完整命令，悬浮显示说明；长任务会等到超时，由后端 timeout 兜底）
const quickGroups = [
  {
    title: 'Git',
    items: [
      { cmd: 'git status', desc: '查看工作区状态' },
      { cmd: 'git pull', desc: '拉取远程更新' },
      { cmd: 'git add -A && git commit -m "{msg}"', desc: '暂存并提交', prompt: '提交消息' },
      { cmd: 'git add -A', desc: '暂存所有改动' },
      { cmd: 'git push', desc: '推送' },
      { cmd: 'git checkout -b feature', desc: '创建并切换到新分支' },
      { cmd: 'git diff', desc: '查看未暂存差异' },
      { cmd: 'git branch -a', desc: '查看所有分支' },
      { cmd: 'git log --oneline -10', desc: '最近 10 条提交' },
    
    ],
  },
  {
    title: 'JS / Node',
    items: [
      { cmd: 'npm install', desc: '安装依赖' },
      { cmd: 'npm run dev', desc: '启动前端开发服务器' },
      { cmd: 'npm run build', desc: '构建生产包' },
      { cmd: 'npm run lint', desc: '代码检查' },
      { cmd: 'node server/index.js', desc: '运行 Node 服务' },
      { cmd: 'npx vite', desc: '启动 Vite' },
    ],
  },
   {
    title: 'Java',
    items: [
      { cmd: 'mvn clean install', desc: 'Maven 清理并打包' },
      { cmd: 'mvn spring-boot:run', desc: '启动 Spring Boot' },
      { cmd: 'gradle build', desc: 'Gradle 构建' },
      { cmd: 'gradle bootRun', desc: 'Gradle 启动应用' },
      { cmd: 'java -jar app.jar', desc: '运行 Jar 包' },
      { cmd: 'javac Main.java', desc: '编译 Java 文件' },
    ],
  },
  {
    title: 'Python',
    items: [
      { cmd: 'pip install -r requirements.txt', desc: '安装 Python 依赖' },
      { cmd: 'python app.py', desc: '运行 Python 程序' },
      { cmd: 'python -m venv venv', desc: '创建虚拟环境' },
      { cmd: 'pytest', desc: '运行测试' },
      { cmd: 'pip list', desc: '查看已装包' },
    ],
  },
 
  {
    title: '通用',
    items: [
      { cmd: 'dir', desc: '列出当前目录' },
      { cmd: 'echo %cd%', desc: '显示当前路径' },
      { cmd: 'npm cache clean --force', desc: '清理 npm 缓存' },
      { cmd: 'git --version', desc: '查看 Git 版本' },
    ],
  },
]

function fillCommand(cmd) {
  if (running.value || disabled.value) return
  command.value = cmd
}
function runQuick(cmd) {
  if (running.value || disabled.value) return
  command.value = cmd
  onRun()
}

// 需要用户输入消息的快捷命令（命令模板含 {msg} 占位）
const commitMsgVisible = ref(false)
const commitMsg = ref('')
const pendingTmpl = ref('')
const pendingMode = ref('run')

function openMsgPrompt(tmpl, mode) {
  pendingTmpl.value = tmpl
  pendingMode.value = mode
  commitMsg.value = ''
  commitMsgVisible.value = true
}
function onMsgOk() {
  const final = pendingTmpl.value.replace('{msg}', commitMsg.value.trim() || 'update')
  commitMsgVisible.value = false
  if (pendingMode.value === 'append') {
    const cur = command.value.trim()
    command.value = cur ? `${cur} && ${final}` : final
  } else {
    runQuick(final)
  }
}

// 单击立即执行，双击仅填入（用计时器区分，避免双击误触发执行）
let clickTimer = null
function onQuickClick(cmd) {
  if (running.value || disabled.value) return
  if (cmd.includes('{msg}')) {
    clearTimeout(clickTimer)
    openMsgPrompt(cmd, 'run')
    return
  }
  clearTimeout(clickTimer)
  clickTimer = setTimeout(() => runQuick(cmd), 200)
}
function onQuickDblClick(cmd) {
  clearTimeout(clickTimer)
  if (cmd.includes('{msg}')) {
    openMsgPrompt(cmd, 'append')
    return
  }
  const cur = command.value.trim()
  command.value = cur ? `${cur} && ${cmd}` : cmd
}

function scrollToBottom() {
  nextTick(() => {
    const el = outputRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// 拖动输出区底边的手柄调整高度（仅本次生效）
function startResize(e) {
  e.preventDefault()
  const startY = e.clientY
  const startH = outputRef.value ? outputRef.value.offsetHeight : 256
  const onMove = (ev) => {
    const h = Math.max(120, Math.min(640, startH + (ev.clientY - startY)))
    outputHeight.value = `${h}px`
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
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
        <Select
          v-model:value="selectedShell"
          :options="shellOptions"
          size="small"
          class="terminal-drawer__shell"
        />
      </div>
    </template>
    <template #extra>
      <button class="terminal-drawer__close" @click="emit('update:open', false)">
        <X :size="16" />
      </button>
    </template>

    <div class="terminal-drawer__body">
    <Alert
      v-if="disabled"
      type="warning"
      show-icon
      :message="`当前为 ${permission} 模式，无法执行命令。请到设置切换为「完全访问」。`"
      class="terminal-drawer__warn"
    />

    <div class="terminal-drawer__display">
      <Button
        v-if="history.length > 0"
        type="text"
        size="small"
        class="terminal-drawer__clear"
        :disabled="running"
        @click="clearHistory"
      >
        <template #icon><Trash2 :size="12" /></template>
        清屏
      </Button>

    <div class="terminal-drawer__cmdline">
      <span class="terminal-drawer__prompt">$</span>
      <Input
        v-model:value="command"
        :disabled="disabled || running"
        placeholder="输入命令...（快捷命令单击执行、双击填入）"
        class="terminal-drawer__input"
        @keydown="onKeydown"
      />
      <Button
        type="primary"
        :disabled="disabled || running || !command.trim()"
        @click="onRun"
      >
        <template #icon><Play :size="12" /></template>
        运行
      </Button>
    </div>

    <div ref="outputRef" class="terminal-drawer__output" :style="{ height: outputHeight }">
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
    </div>

    <div class="terminal-drawer__resize" @mousedown="startResize"></div>

    <div class="terminal-drawer__quick">
      <div v-for="g in quickGroups" :key="g.title" class="terminal-drawer__quick-group">
        <span class="terminal-drawer__quick-title">{{ g.title }}</span>
        <div class="terminal-drawer__quick-items">
          <button
            v-for="q in g.items"
            :key="q.cmd"
            type="button"
            class="terminal-drawer__quick-btn"
            :title="`${q.desc}（单击执行，双击仅填入）`"
            :disabled="disabled || running"
            @click="onQuickClick(q.cmd)"
            @dblclick="onQuickDblClick(q.cmd)"
          >
            {{ q.cmd }}
          </button>
        </div>
      </div>
    </div>
    </div>

    <Modal
      v-model:open="commitMsgVisible"
      title="提交消息"
      ok-text="确定"
      cancel-text="取消"
      @ok="onMsgOk"
    >
      <Input
        v-model:value="commitMsg"
        placeholder="输入提交消息..."
        @keydown.enter="onMsgOk"
      />
    </Modal>
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
.terminal-drawer__shell {
  margin-left: 12px;
}
.terminal-drawer__shell :deep(.ant-select-selector) {
  background: var(--color-bg-subtle);
  border-color: var(--color-border);
}
.terminal-drawer__shell :deep(.ant-select-selection-item) {
  color: var(--color-text);
}
.terminal-drawer__warn {
  margin-bottom: 12px;
}
.terminal-drawer__body {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.terminal-drawer__body :deep(.ant-drawer-body) {
  overflow: hidden;
}
.terminal-drawer__quick {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 18px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.terminal-drawer__quick-group {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.terminal-drawer__quick-title {
  flex: 0 0 36px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  line-height: 26px;
  text-align: right;
}
.terminal-drawer__quick-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.terminal-drawer__quick-btn {
  padding: 4px 10px;
  font-size: 12px;
  line-height: 16px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-subtle);
  color: var(--color-text);
  font-family: 'Fira Code', Consolas, monospace;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  white-space: nowrap;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.terminal-drawer__quick-btn:hover:not(:disabled) {
  background: var(--color-primary-bg);
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.terminal-drawer__quick-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.terminal-drawer__display {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--code-block-bg);
}
.terminal-drawer__clear {
  position: absolute;
  top: 46px;
  right: 8px;
  z-index: 2;
  color: var(--color-text-muted) !important;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}
.terminal-drawer__clear:hover:not(:disabled) {
  color: var(--color-text) !important;
  background: rgba(255, 255, 255, 0.14);
}
.terminal-drawer__clear:disabled {
  opacity: 0.4;
}
.terminal-drawer__output {
  position: relative;
  flex: none;
  overflow-y: auto;
  border: none;
  border-radius: 0;
  background: var(--code-block-bg);
  color: var(--code-block-text);
  padding: 12px;
  font-family: 'Fira Code', Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.6;
}
.terminal-drawer__resize {
  height: 8px;
  margin: 2px 0;
  cursor: row-resize;
  border-radius: 4px;
  background: transparent;
  transition: background 0.12s;
}
.terminal-drawer__resize:hover {
  background: var(--color-border);
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
.terminal-drawer__cmdline {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
  border-radius: 0;
  background: var(--code-block-bg);
  color: var(--code-block-text);
  font-family: 'Fira Code', Consolas, monospace;
}
.terminal-drawer__cmdline .terminal-drawer__prompt {
  color: var(--color-primary);
  font-weight: 600;
  opacity: 0.9;
}
.terminal-drawer__input {
  flex: 1;
  min-width: 0;
}
.terminal-drawer__cmdline :deep(.ant-input) {
  background: transparent;
  border: none;
  box-shadow: none;
  color: var(--code-block-text);
  font-family: 'Fira Code', Consolas, monospace;
  padding-left: 0;
  padding-right: 0;
}
.terminal-drawer__cmdline :deep(.ant-input::placeholder) {
  color: var(--color-text-muted);
}
.terminal-drawer__cmdline :deep(.ant-btn-primary:disabled) {
  background: var(--color-primary);
  color: #fff;
  opacity: 0.65;
}
.terminal-drawer__cmdline > :deep(.ant-btn) {
  flex: 0 0 auto;
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  white-space: nowrap;
}
</style>
