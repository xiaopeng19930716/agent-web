<template>
  <a-config-provider :theme="antdTheme">
    <div class="app">
    <aside class="sidebar">
      <button class="new-chat" @click="onNewChat">
        <Plus :size="16" />
        <span>新对话</span>
      </button>

      <div class="search">
        <Search :size="15" class="search__icon" />
        <input v-model="keyword" class="search__input" type="text" placeholder="搜索" />
      </div>

      <nav class="conv-list">
        <template v-for="(grp, idx) in groupedConversations" :key="grp.key">
          <!-- 在第一个项目之前插入"添加项目"按钮（即：通用对话最下方、首项目上方） -->
          <button
            v-if="idx === firstProjectIndex"
            type="button"
            class="conv-group__addproject"
            @click.stop.prevent="openAddProject"
          >
            <Plus :size="13" />
            <span>添加项目</span>
          </button>

          <div v-if="grp.isProject" class="conv-group__head">
            <div class="conv-group__title">{{ grp.label }}</div>
            <div class="conv-group__actions">
              <span
                v-if="grp.isProject"
                class="conv-group__add"
                title="在该项目中新增对话"
                @click.stop.prevent="newProjectSession(grp.key)"
              >+</span>
              <span
                v-if="grp.isProject"
                class="conv-group__del"
                title="删除项目"
                @click.stop.prevent="confirmRemoveProject(grp.key)"
              >×</span>
            </div>
          </div>
          <button
            v-for="s in grp.items"
            :key="s.id"
            class="conv-item"
            :class="{
              'conv-item--active': s.id === activeSessionId,
              'conv-item--editing': editingConvId === s.id,
            }"
            @click="selectSession(s.id)"
          >

            <MessageSquare :size="15" class="conv-item__icon" />
            <input
              v-if="editingConvId === s.id"
              v-model="convTitleDraft"
              class="conv-item__title-input"
              :maxlength="60"
              @keydown.enter.prevent="commitConvRename(s.id)"
              @keydown.esc.prevent="cancelConvRename"
              @blur="commitConvRename(s.id)"
              @mousedown.stop
              @click.stop
              @dblclick.stop
            />
            <span
              v-else
              class="conv-item__title"
              title="双击修改会话名称"
              @dblclick.stop="startConvRename(s)"
            >{{ s.title || '新对话' }}</span>
            <span
              v-if="s.messages && s.messages.length > 0"
              class="conv-item__del"
              title="归档对话"
              @click.stop.prevent="removeSession(s.id)"
            >
              <Archive :size="14" />
            </span>
            <span
              v-else
              class="conv-item__del conv-item__del--remove"
              title="删除对话"
              @click.stop.prevent="removeSession(s.id)"
            >
              <Trash2 :size="14" />
            </span>
          </button>
        </template>

        <div v-if="groupedConversations.length === 0" class="conv-empty">
          暂无对话，点击「新对话」开始
        </div>

        <!-- 没有项目时（仅通用对话 / 无任何内容）也显示添加项目按钮 -->
        <button
          v-if="firstProjectIndex === -1"
          type="button"
          class="conv-group__addproject"
          @click.stop.prevent="openAddProject"
        >
          <Plus :size="13" />
          <span>添加项目</span>
        </button>
      </nav>

      <div class="sidebar__footer">
        <RouterLink to="/usage" class="footer-setting">
          <BarChart3 :size="16" />
          <span>用量</span>
        </RouterLink>
        <button class="footer-setting" type="button" @click="toggleTheme">
          <component :is="isDark ? Sun : Moon" :size="16" />
          <span>{{ isDark ? '亮色模式' : '暗色模式' }}</span>
        </button>
        <RouterLink to="/settings" class="footer-setting">
          <Settings :size="16" />
          <span>设置</span>
        </RouterLink>
      </div>
    </aside>

    <main class="main">
      <RouterView />
    </main>
    </div>
  </a-config-provider>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRouter, useRoute } from 'vue-router'
import { theme as antdThemeTokens } from 'ant-design-vue'
import { Plus, Search, Settings, MessageSquare, Archive, Trash2, Sun, Moon, BarChart3 } from 'lucide-vue-next'
import { projects, activeProjectId, removeProject, fetchProjects } from './projects.js'
import { createSession, fetchSessions, deleteSession, archiveSession, updateSession, sessions, NO_PROJECT_KEY } from './sessions.js'
import { emitBus } from './bus.js'

const router = useRouter()
const route = useRoute()
const keyword = ref('')

const activeSessionId = computed(() => sessions.activeSessionId)

// ant-design-vue 暗色主题：跟随全局 isDark 切换 darkAlgorithm
const antdTheme = computed(() =>
  isDark.value
    ? {
        algorithm: antdThemeTokens.darkAlgorithm,
        token: {
          colorBgContainer: '#1e293b',
          colorBgElevated: '#1e293b',
          colorBorder: '#334155',
          colorBorderSecondary: '#334155',
        },
      }
    : {}
)

// 暗色模式：状态持久化到 localStorage（key: agent-theme），启动时由 main.js 应用
const isDark = ref(document.documentElement.classList.contains('dark'))
function applyTheme(dark) {
  const el = document.documentElement
  el.classList.add('theme-transition')
  if (dark) el.classList.add('dark')
  else el.classList.remove('dark')
  localStorage.setItem('agent-theme', dark ? 'dark' : 'light')
  window.clearTimeout(applyTheme._t)
  applyTheme._t = window.setTimeout(() => el.classList.remove('theme-transition'), 250)
}
function toggleTheme() {
  isDark.value = !isDark.value
  applyTheme(isDark.value)
}

// 第一个真实项目组在分组列表中的索引；无项目时返回 -1
// 用于把"添加项目"按钮插在「通用对话最下方、首个项目上方」
const firstProjectIndex = computed(() => {
  const groups = groupedConversations.value
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].isProject) return i
  }
  return -1
})

const groupedConversations = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const match = (s) => {
    if (!kw) return true
    const t = (s.title || '').toLowerCase()
    const firstMsg = (s.messages && s.messages[0] && s.messages[0].content || '').toLowerCase()
    return t.includes(kw) || firstMsg.includes(kw)
  }
  const sorted = [...sessions.list]
    .filter((s) => !s.archived) // 归档会话不显示在左侧面板
    .filter(match)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))

  // 按项目分组：通用对话置顶，其余每个项目一组（即使无会话也显示项目名）
  const groups = []
  const byProject = new Map()
  for (const s of sorted) {
    const pid = s.projectId || NO_PROJECT_KEY
    if (!byProject.has(pid)) byProject.set(pid, [])
    byProject.get(pid).push(s)
  }
  if (byProject.has(NO_PROJECT_KEY)) {
    groups.push({ key: NO_PROJECT_KEY, label: '通用对话', items: byProject.get(NO_PROJECT_KEY), isProject: false })
    byProject.delete(NO_PROJECT_KEY)
  }
  const plist = [...projects.list].sort((a, b) => (a.alias || '').localeCompare(b.alias || ''))
  for (const p of plist) {
    const items = byProject.get(p.id) || []
    groups.push({ key: p.id, label: p.alias, items, isProject: true })
    byProject.delete(p.id)
  }
  // 会话存在但项目已被删除的兜底
  for (const [pid, items] of byProject) {
    groups.push({ key: pid, label: '(未知项目)', items, isProject: false })
  }
  // 非搜索时项目名组总是显示；搜索时只保留有匹配会话的组
  return groups.filter((g) => g.items.length > 0 || (!kw && g.isProject))
})

function selectSession(id) {
  sessions.activeSessionId = id
  const s = sessions.list.find((x) => x.id === id)
  if (s) {
    activeProjectId.id = s.projectId && s.projectId !== NO_PROJECT_KEY ? s.projectId : ''
  }
  // 把当前会话 ID 写入路由，刷新后可由 URL 恢复
  router.push('/chat/' + id)
}

// 归档会话：标记为 archived（数据保留在后端），并从左侧面板移除；跳转到相邻未归档会话
// 注意：若会话没有任何对话内容（messages 为空），则直接物理删除，无需保留空归档
async function removeSession(id) {
  const target = sessions.list.find((s) => s.id === id)
  const hasContent = target && Array.isArray(target.messages) && target.messages.length > 0
  const sorted = [...sessions.list]
    .filter((s) => !s.archived)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  const idx = sorted.findIndex((s) => s.id === id)
  try {
    if (hasContent) {
      await archiveSession(id)
    } else {
      await deleteSession(id)
    }
  } catch (e) {
    console.error('归档会话失败:', e)
    return
  }
  // archiveSession 已把该条从 sessions.list 移除，这里基于过滤后的列表计算相邻项
  const rest = [...sessions.list]
    .filter((s) => !s.archived)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  if (rest.length === 0) {
    sessions.activeSessionId = null
    router.push('/chat')
    return
  }
  let next
  if (idx - 1 >= 0 && rest[idx - 1]) next = rest[idx - 1]
  else if (rest[idx]) next = rest[idx]
  else next = rest[rest.length - 1]
  sessions.activeSessionId = next.id
  const s = sessions.list.find((x) => x.id === next.id)
  if (s) {
    activeProjectId.id = s.projectId && s.projectId !== NO_PROJECT_KEY ? s.projectId : ''
  }
  router.push('/chat/' + next.id)
}

// 删除项目：二次确认后级联删除该项目及其所有会话
async function confirmRemoveProject(pid) {
  const p = projects.list.find((x) => x.id === pid)
  const label = p ? p.alias : '该项目'
  if (!window.confirm(`确定删除项目「${label}」吗？该项目下的所有对话也会一并删除。`)) return
  try {
    await removeProject(pid)
    sessions.list = sessions.list.filter((s) => (s.projectId || NO_PROJECT_KEY) !== pid)
    if (activeProjectId.id === pid) activeProjectId.id = ''
    if (sessions.activeSessionId && !sessions.list.some((s) => s.id === sessions.activeSessionId)) {
      sessions.activeSessionId = null
    }
  } catch (e) {
    console.error('删除项目失败:', e)
  }
}

async function onNewChat() {
  // 左上角"新对话"：始终创建一个新的通用对话（不关联项目），并切到通用对话
  activeProjectId.id = ''
  const session = await createSession(NO_PROJECT_KEY)
  router.push('/chat/' + session.id)
}

// 侧边栏项目名旁的「＋」：在该项目中新增一个对话
async function newProjectSession(pid) {
  activeProjectId.id = pid
  const session = await createSession(pid)
  router.push('/chat/' + session.id)
}

// 通用对话分组下的"添加项目"入口：派发总线事件，由 ChatPanel 监听并打开弹窗
function openAddProject() {
  emitBus('open-add-project')
  // 兜底：若 ChatPanel 还未挂载（极少见），则跳转 chat 路由后再触发一次
  if (router.currentRoute.value.path !== '/chat') {
    router.push('/chat').then(() => emitBus('open-add-project'))
  }
}

// 侧边栏会话项双击改名
const editingConvId = ref(null)
const convTitleDraft = ref('')
function startConvRename(s) {
  editingConvId.value = s.id
  convTitleDraft.value = s.title || '新对话'
  // 选中并聚焦输入框
  setTimeout(() => {
    const el = document.querySelector('.conv-item--editing .conv-item__title-input')
    if (el) {
      el.focus()
      el.select()
    }
  }, 0)
}
async function commitConvRename(id) {
  if (editingConvId.value !== id) return
  const next = convTitleDraft.value.trim() || '新对话'
  const target = sessions.list.find((x) => x.id === id)
  editingConvId.value = null
  if (target && target.title !== next) {
    target.title = next
    try {
      await updateSession(id, { title: next })
    } catch (e) {
      console.error('重命名失败:', e)
    }
  }
}
function cancelConvRename() {
  editingConvId.value = null
}

// 根据路由中的 sessionId 恢复当前会话（刷新/深链/前进后退时保持）
function syncActiveFromRoute() {
  const id = route.params.sessionId
  if (!id) return // 无参数：保持现有默认/最近会话
  if (sessions.list.some((s) => s.id === id)) {
    sessions.activeSessionId = id
    const s = sessions.list.find((x) => x.id === id)
    if (s) {
      activeProjectId.id = s.projectId && s.projectId !== NO_PROJECT_KEY ? s.projectId : ''
    }
  }
}

onMounted(async () => {
  try {
    // 会话与项目并行加载，避免项目下会话在刷新后因项目列表为空而落入"未知项目"被过滤
    // 左侧对话框仅加载未归档会话（archived=0）
    await Promise.all([fetchSessions(0), fetchProjects()])
    // 会话加载完成后，用 URL 中的 sessionId 恢复当前会话
    syncActiveFromRoute()
  } catch (e) {
    console.error('加载失败:', e)
  }
})

// 路由参数变化（如浏览器前进/后退）时同步当前会话
watch(
  () => route.params.sessionId,
  () => syncActiveFromRoute()
)

// 项目列表变化时若没有活动会话则保持
watch(
  () => sessions.list.length,
  () => {}
)
</script>

<style scoped lang="less">
.app {
  display: flex;
  height: 100vh;
  background: var(--color-bg);
}
.sidebar {
  width: 280px;
  flex-shrink: 0;
  background: var(--color-bg);
  border-right: 1px solid @color-border;
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
  gap: 12px;
}
.new-chat {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  .btn-rounded(@radius-lg);
  border: 1px solid @color-primary;
  background: @color-primary;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;

  &:hover {
    background: @color-primary-hover;
  }
  &:active {
    transform: scale(0.98);
  }
}
.search {
  position: relative;
  display: flex;
  align-items: center;

  &__icon {
    position: absolute;
    left: 12px;
    color: @color-text-muted;
  }
  &__input {
    width: 100%;
    height: 38px;
    .btn-rounded(@radius-lg);
    border: none;
    background: @color-bg-subtle;
    padding: 0 12px 0 34px;
    font-size: 14px;
    color: @color-text-strong;
    outline: none;

    &:focus {
      box-shadow: 0 0 0 2px @color-primary;
    }
  }
}
.conv-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: 4px;
}
.conv-group {
  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 16px 8px 6px;
  }
  &__title {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0;
    color: @color-text-strong;
  }
  &__del {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    .btn-rounded(5px);
    color: @color-text-muted;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s, background 0.12s, color 0.12s;
  }
  &__head:hover &__del {
    opacity: 1;
  }
  &__actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  &__add {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    .btn-rounded(5px);
    color: @color-text-muted;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s, background 0.12s, color 0.12s;
  }
  &__head:hover &__add {
    opacity: 1;
  }
  &__add:hover {
    background: @color-primary-active-bg;
    color: @color-primary;
  }
  &__del:hover {
    background: rgba(220, 38, 38, 0.12);
    color: #ef4444;
  }
}
.conv-group__addproject {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 12px 14px 8px;
  padding: 6px 10px;
  width: calc(100% - 28px);
  border: 1px dashed @color-border;
  border-radius: 8px;
  background: transparent;
  color: @color-text-muted;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.conv-group__addproject:hover {
  background: @color-primary-active-bg;
  border-color: @color-primary;
  color: @color-primary;
}
.conv-group__addproject svg {
  flex-shrink: 0;
}
.conv-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  .btn-rounded(@radius-md);
  padding: 9px 10px;
  cursor: pointer;
  color: @color-text;
  font-size: 14px;
  position: relative;

  &:hover {
    background: @color-bg-subtle;
  }
  &--active {
    background: @color-primary-active-bg;
    color: @color-primary;

    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 8px;
      bottom: 8px;
      width: 3px;
      .btn-rounded(2px);
      background: @color-primary;
    }
  }
  &__icon {
    color: @color-text-muted;
    flex-shrink: 0;
  }
  &--active &__icon {
    color: @color-primary;
  }
  &__title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    cursor: text;
    .btn-rounded(4px);
    padding: 1px 2px;
    margin: -1px -2px;
  }
  &--editing {
    background: @color-primary-active-bg;
    cursor: text;
  }
  &__title-input {
    flex: 1;
    min-width: 0;
    border: 1px solid @color-primary;
    .btn-rounded(4px);
    padding: 3px 6px;
    font-size: 14px;
    color: @color-text-strong;
    background: var(--color-bg);
    outline: none;
    font-family: inherit;
    box-shadow: 0 0 0 2px @color-primary;
  }
  &__del {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    .btn-rounded(@radius-sm);
    color: @color-text-muted;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s, background 0.12s, color 0.12s;
  }
  &:hover &__del {
    opacity: 1;
  }
  &__del:hover {
    background: @color-bg-subtle;
    color: @color-primary;
  }
  &__del--remove:hover {
    background: #fee2e2;
    color: #dc2626;
  }
}
.conv-empty {
  color: @color-text-muted;
  font-size: 13px;
  text-align: center;
  padding: 24px 12px;
}
.sidebar__footer {
  border-top: 1px solid @color-border;
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.footer-setting {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  .btn-rounded(@radius-md);
  color: @color-text;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  background: transparent;
  border: none;
  cursor: pointer;
  width: 100%;

  &:hover {
    background: @color-bg-subtle;
  }
}
.main {
  flex: 1;
  min-width: 0;
  height: 100vh;
  overflow: hidden;
}
</style>
