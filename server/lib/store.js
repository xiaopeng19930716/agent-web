import fs from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { DATA_DIR } from './config.js'

// 供 upload 等路由复用同一数据目录
export { DATA_DIR }

const __dirname = dirname(fileURLToPath(import.meta.url))

// 项目存储（后端信任的唯一路径来源，防止前端越权访问任意目录）
// 统一存放在 ~/.code-agent/data（详见 config.js 的 CODE_AGENT_ROOT），
// 网页版与 Electron 版共用，避免数据割裂；打包后该目录可写，不受 asar 只读限制。
export const PROJECTS_FILE = join(DATA_DIR, 'projects.json')
/** @type {Map<string, {id:string, alias:string, path:string, modelId?:string}>} */
export const projects = new Map()

// 会话存储（按项目归属，持久化对话消息）
export const NO_PROJECT_KEY = '__none__'
export const SESSIONS_FILE = join(DATA_DIR, 'sessions.json')
/** @type {Map<string, {id:string, projectId:string, title:string, messages:any[], createdAt:number, updatedAt:number, archived?:boolean}>} */
export const sessions = new Map()

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
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify([...projects.values()], null, 2))
}

export function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const arr = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'))
      for (const s of arr) sessions.set(s.id, s)
    }
  } catch (e) {
    console.error('加载 sessions.json 失败:', e)
  }
}

export function saveSessions() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify([...sessions.values()], null, 2))
}

// 级联归档某项目下的所有会话（供 projects 路由删除时调用）：软删除，保留数据
export function deleteSessionsByProject(projectId) {
  let changed = false
  for (const [sid, s] of [...sessions.entries()]) {
    if ((s.projectId || NO_PROJECT_KEY) === projectId) {
      s.archived = true
      changed = true
    }
  }
  if (changed) saveSessions()
}

export function initStores() {
  loadProjects()
  loadSessions()
}
