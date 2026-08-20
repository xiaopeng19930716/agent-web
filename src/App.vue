<template>
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
        <template v-for="grp in groupedConversations" :key="grp.key">
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
              class="conv-item__del"
              title="删除对话"
              @click.stop.prevent="removeSession(s.id)"
            >×</span>
          </button>
          <button
            v-if="!grp.isProject"
            class="conv-group__addproject"
            @click.stop.prevent="openAddProject"
          >
            <Plus :size="13" />
            <span>添加项目</span>
          </button>
        </template>

        <div v-if="groupedConversations.length === 0" class="conv-empty">
          暂无对话，点击「新对话」开始
        </div>
      </nav>

      <div class="sidebar__footer">
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
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { Plus, Search, Settings, MessageSquare } from 'lucide-vue-next'
import { projects, activeProjectId, removeProject } from './projects.js'
import { createSession, fetchSessions, deleteSession, updateSession, sessions, NO_PROJECT_KEY } from './sessions.js'
import { emitBus } from './bus.js'

const router = useRouter()
const keyword = ref('')

const activeSessionId = computed(() => sessions.activeSessionId)

const groupedConversations = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const match = (s) => {
    if (!kw) return true
    const t = (s.title || '').toLowerCase()
    const firstMsg = (s.messages && s.messages[0] && s.messages[0].content || '').toLowerCase()
    return t.includes(kw) || firstMsg.includes(kw)
  }
  const sorted = [...sessions.list]
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
  router.push('/chat')
}

// 删除会话：跳转到列表中的上一个会话；该项目会话删完则只显示项目名
async function removeSession(id) {
  const sorted = [...sessions.list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  const idx = sorted.findIndex((s) => s.id === id)
  try {
    await deleteSession(id)
  } catch (e) {
    console.error('删除会话失败:', e)
    return
  }
  const rest = [...sessions.list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  if (rest.length === 0) {
    sessions.activeSessionId = null
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
  await createSession(NO_PROJECT_KEY)
  router.push('/chat')
}

// 侧边栏项目名旁的「＋」：在该项目中新增一个对话
async function newProjectSession(pid) {
  activeProjectId.id = pid
  await createSession(pid)
  router.push('/chat')
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

onMounted(async () => {
  try {
    await fetchSessions()
  } catch (e) {
    console.error('加载会话失败:', e)
  }
})

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
  background: @color-bg;
}
.sidebar {
  width: 280px;
  flex-shrink: 0;
  background: #ffffff;
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
    color: #1f2937;
    outline: none;

    &:focus {
      box-shadow: 0 0 0 2px #bfdbfe;
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
    background: #dbeafe;
    color: @color-primary;
  }
  &__del:hover {
    background: #fee2e2;
    color: #dc2626;
  }
}
.conv-group__addproject {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 10px 14px 6px;
  padding: 6px 10px;
  width: calc(100% - 28px);
  border: 1px dashed #d1d5db;
  border-radius: 8px;
  background: transparent;
  color: @color-text-muted;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.conv-group__addproject:hover {
  background: #eff6ff;
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
    color: #1e40af;

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

    &:hover {
      background: #e2e8f0;
    }
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
    color: #1f2937;
    background: #fff;
    outline: none;
    font-family: inherit;
    box-shadow: 0 0 0 2px #bfdbfe;
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
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s, background 0.12s, color 0.12s;
  }
  &:hover &__del {
    opacity: 1;
  }
  &__del:hover {
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
  color: #475569;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;

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
