import fs from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 项目存储（后端信任的唯一路径来源，防止前端越权访问任意目录）
export const DATA_DIR = join(__dirname, '..', 'data')
export const PROJECTS_FILE = join(DATA_DIR, 'projects.json')
/** @type {Map<string, {id:string, alias:string, path:string, modelId?:string}>} */
export const projects = new Map()

// 会话存储（按项目归属，持久化对话消息）
export const NO_PROJECT_KEY = '__none__'
export const SESSIONS_FILE = join(DATA_DIR, 'sessions.json')
/** @type {Map<string, {id:string, projectId:string, title:string, messages:any[], createdAt:number, updatedAt:number}>} */
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

// 级联删除某项目下的所有会话（供 projects 路由删除时调用）
export function deleteSessionsByProject(projectId) {
  let removed = false
  for (const [sid, s] of [...sessions.entries()]) {
    if ((s.projectId || NO_PROJECT_KEY) === projectId) {
      sessions.delete(sid)
      removed = true
    }
  }
  if (removed) saveSessions()
}

export function initStores() {
  loadProjects()
  loadSessions()
}
