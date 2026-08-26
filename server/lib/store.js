import fs from 'fs'
import { renameSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { DATA_DIR } from './config.js'

// 供 upload 等路由复用同一数据目录
export { DATA_DIR }

const __dirname = dirname(fileURLToPath(import.meta.url))

// 项目存储（后端信任的唯一路径来源，防止前端越权访问任意目录）
// 统一存放在 ~/.code-agent/data（详见 config.js 的 CODE_AGENT_ROOT），
// 网页版与 Electron 版共用，避免数据割裂；打包后该目录可写，不受 asar 只读限制。
export const PROJECTS_FILE = join(DATA_DIR, 'projects.json')

// 会话存储拆分为「索引 + 按会话 ID 分文件」，避免单个 sessions.json 无限膨胀：
//   data/sessions/index.json   —— 仅元数据（不含 messages），列表加载只读它
//   data/sessions/<sid>.json   —— 单会话完整数据（含 messages），点开时才按需读取
export const SESSIONS_DIR = join(DATA_DIR, 'sessions')
export const SESSIONS_INDEX = join(SESSIONS_DIR, 'index.json')
// 旧版单文件（迁移来源，迁移后重命名为 .bak）
export const LEGACY_SESSIONS_FILE = join(DATA_DIR, 'sessions.json')

/** @type {Map<string, {id:string, projectId:string, title:string, createdAt:number, updatedAt:number, archived?:boolean, messageCount:number}>} */
export const sessions = new Map()
/** @type {Map<string, {id:string, alias:string, path:string, modelId?:string}>} */
export const projects = new Map()

// 原子写：先写临时文件再 rename，避免写盘中断损坏数据
function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(obj, null, 2))
  renameSync(tmp, file)
}

function readIndex() {
  try {
    if (existsSync(SESSIONS_INDEX)) {
      const arr = JSON.parse(readFileSync(SESSIONS_INDEX, 'utf-8'))
      return Array.isArray(arr) ? arr : []
    }
  } catch (e) {
    console.error('读取 sessions 索引失败:', e)
  }
  return []
}

export function loadProjects() {
  try {
    if (fs.existsSync(PROJECTS_FILE)) {
      const arr = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'))
      for (const p of arr) projects.set(p.id, p)
    }
  } catch (e) {
    console.error('加载 projects.json 失败:', e)
  }
}

export function saveProjects() {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(PROJECTS_FILE, JSON.stringify([...projects.values()], null, 2))
}

// 从索引条目构建内存中的轻量 Map（不含 messages）
export function loadSessions() {
  // 首次运行时把旧版单文件 sessions.json 拆分为索引 + 分文件
  if (!existsSync(SESSIONS_INDEX) && existsSync(LEGACY_SESSIONS_FILE)) {
    migrateLegacySessions()
  }
  const idx = readIndex()
  sessions.clear()
  for (const meta of idx) {
    sessions.set(meta.id, {
      id: meta.id,
      projectId: meta.projectId || '__none__',
      title: meta.title || '新对话',
      createdAt: meta.createdAt || 0,
      updatedAt: meta.updatedAt || 0,
      archived: !!meta.archived,
      messageCount: meta.messageCount || 0,
    })
  }
}

// 读取单个会话完整数据（含 messages）；不存在返回 null
export function getSession(id) {
  const file = join(SESSIONS_DIR, id + '.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch (e) {
    console.error('读取会话', id, '失败:', e)
    return null
  }
}

// 写入单个会话：完整数据落 <sid>.json，并同步更新索引
export function saveSession(session) {
  const meta = {
    id: session.id,
    projectId: session.projectId || '__none__',
    title: session.title || '新对话',
    createdAt: session.createdAt || Date.now(),
    updatedAt: session.updatedAt || Date.now(),
    archived: !!session.archived,
    messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
  }
  mkdirSync(SESSIONS_DIR, { recursive: true })
  writeJsonAtomic(join(SESSIONS_DIR, session.id + '.json'), { ...meta, messages: session.messages || [] })
  const idx = readIndex().filter((x) => x.id !== session.id)
  idx.push(meta)
  idx.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  writeJsonAtomic(SESSIONS_INDEX, idx)
  sessions.set(session.id, meta)
}

// 仅写索引（列表结构变化且不涉及单会话消息文件时）
export function saveSessions() {
  const idx = [...sessions.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  mkdirSync(SESSIONS_DIR, { recursive: true })
  writeJsonAtomic(SESSIONS_INDEX, idx)
}

// 删除单个会话：删分文件 + 从索引移除
export function deleteSession(id) {
  const file = join(SESSIONS_DIR, id + '.json')
  if (existsSync(file)) fs.unlinkSync(file)
  sessions.delete(id)
  saveSessions()
}

// 级联归档某项目下的所有会话（供 projects 路由删除时调用）：软删除，保留数据
export function deleteSessionsByProject(projectId) {
  let changed = false
  for (const [sid, s] of [...sessions.entries()]) {
    if ((s.projectId || '__none__') === projectId) {
      s.archived = true
      changed = true
    }
  }
  if (changed) saveSessions()
}

// 旧版单文件 → 索引 + 分文件
function migrateLegacySessions() {
  try {
    const arr = JSON.parse(readFileSync(LEGACY_SESSIONS_FILE, 'utf-8'))
    if (!Array.isArray(arr)) return
    mkdirSync(SESSIONS_DIR, { recursive: true })
    const idx = []
    for (const s of arr) {
      const id = s.id || 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      const meta = {
        id,
        projectId: s.projectId || '__none__',
        title: s.title || '新对话',
        createdAt: s.createdAt || 0,
        updatedAt: s.updatedAt || 0,
        archived: !!s.archived,
        messageCount: Array.isArray(s.messages) ? s.messages.length : 0,
      }
      writeJsonAtomic(join(SESSIONS_DIR, id + '.json'), { ...meta, messages: s.messages || [] })
      idx.push(meta)
    }
    idx.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    writeJsonAtomic(SESSIONS_INDEX, idx)
    // 备份旧文件，避免误覆盖
    renameSync(LEGACY_SESSIONS_FILE, LEGACY_SESSIONS_FILE + '.bak')
    console.log(`[迁移] 已将 ${idx.length} 个会话从 sessions.json 拆分为 data/sessions/`)
  } catch (e) {
    console.error('迁移旧 sessions.json 失败:', e)
  }
}

export function initStores() {
  loadProjects()
  loadSessions()
}
