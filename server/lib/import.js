import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { parseSkillFrontmatter } from './skills.js'
import { CONFIG_DIR } from './config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const home = os.homedir()
const apData = process.env.APPDATA || join(home, 'AppData', 'Roaming')
const projectRootDir = join(__dirname, '..', '..')

// 各 Agent 的默认配置（可被用户覆盖）。configFiles 为 MCP 配置文件候选，skillDirs 为 Skills 目录候选
export const IMPORT_SOURCE_DEFAULTS = [
  {
    id: 'claude',
    label: 'Claude Code',
    configFiles: [join(home, '.claude.json'), join(home, '.claude', 'settings.json'), join(home, '.claude', 'mcp.json')],
    skillDirs: [join(home, '.claude', 'skills')],
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    configFiles: [join(apData, 'Claude', 'claude_desktop_config.json'), join(home, '.config', 'Claude', 'claude_desktop_config.json')],
    skillDirs: [],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    configFiles: [join(home, '.cursor', 'mcp.json')],
    skillDirs: [join(home, '.cursor', 'skills')],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    configFiles: [join(home, '.codeium', 'windsurf', 'mcp_config.json')],
    skillDirs: [],
  },
  {
    id: 'codebuddy',
    label: 'CodeBuddy',
    configFiles: [join(home, '.codebuddy', 'mcp.json'), join(home, '.codebuddy', 'settings.json')],
    skillDirs: [join(home, '.codebuddy', 'skills')],
  },
  {
    id: 'roo',
    label: 'Roo Code',
    configFiles: [join(home, '.roo', 'mcp_settings.json')],
    skillDirs: [],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    configFiles: [join(home, '.config', 'opencode', 'mcp.json'), join(home, '.config', 'opencode', 'settings.json'), join(home, '.opencode', 'mcp.json'), join(home, '.opencode', 'settings.json')],
    skillDirs: [join(home, '.config', 'opencode', 'skills'), join(home, '.opencode', 'skills')],
  },
  {
    id: 'codex',
    label: 'Codex',
    configFiles: [join(home, '.codex', 'config.json'), join(home, '.codex', 'settings.json')],
    skillDirs: [join(home, '.codex', 'skills')],
  },
  {
    id: 'hermes',
    label: 'Hermes',
    configFiles: [join(home, '.hermes', 'config.json'), join(home, '.hermes', 'settings.json'), join(home, '.config', 'hermes', 'config.json'), join(home, '.config', 'hermes', 'settings.json')],
    skillDirs: [join(home, '.hermes', 'skills'), join(home, '.config', 'hermes', 'skills')],
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    configFiles: [],
    skillDirs: [join(home, '.gemini', 'skills')],
  },
  {
    id: 'agents',
    label: '通用 (~/.agents/skills)',
    configFiles: [],
    skillDirs: [join(home, '.agents', 'skills')],
  },
  {
    id: 'home',
    label: '用户主目录 (~/skills)',
    configFiles: [],
    skillDirs: [join(home, 'skills')],
  },
]

// 用户覆盖的导入路径（持久化在 ~/.code-agent/config/import-paths.json）
const IMPORT_PATHS_FILE = join(CONFIG_DIR, 'import-paths.json')
let importPathOverrides = {}
export function loadImportPathOverrides() {
  try {
    if (fs.existsSync(IMPORT_PATHS_FILE)) {
      importPathOverrides = JSON.parse(fs.readFileSync(IMPORT_PATHS_FILE, 'utf-8'))
    }
  } catch (e) {
    console.error('加载 import-paths.json 失败:', e)
  }
}
export function saveImportPathOverrides() {
  fs.mkdirSync(dirname(IMPORT_PATHS_FILE), { recursive: true })
  fs.writeFileSync(IMPORT_PATHS_FILE, JSON.stringify(importPathOverrides, null, 2))
}
loadImportPathOverrides()

// 取得某 Agent 生效中的配置（默认 + 用户覆盖合并）
export function getEffectiveSource(id) {
  const def = IMPORT_SOURCE_DEFAULTS.find((s) => s.id === id)
  if (!def) return null
  const ov = importPathOverrides[id]
  return {
    id: def.id,
    label: def.label,
    configFiles: ov && Array.isArray(ov.configFiles) && ov.configFiles.length ? ov.configFiles : def.configFiles,
    skillDirs: ov && Array.isArray(ov.skillDirs) && ov.skillDirs.length ? ov.skillDirs : def.skillDirs,
    isOverridden: !!(ov && ((Array.isArray(ov.configFiles) && ov.configFiles.length) || (Array.isArray(ov.skillDirs) && ov.skillDirs.length))),
  }
}

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

// 把各 Agent 的 MCP 配置归一化为统一格式
function normalizeMcpEntry(name, raw) {
  if (typeof raw === 'string') raw = { command: raw }
  if (!raw || typeof raw !== 'object') return null
  let type = String(raw.type || '').toLowerCase()
  let command = String(raw.command || '')
  const url = String(raw.url || '')
  if (!type) {
    type = url ? (/\/sse$/i.test(url) ? 'sse' : 'http') : 'stdio'
  }
  if (type === 'streamable-http') type = 'http'
  if (Array.isArray(raw.args)) {
    const args = raw.args.filter((a) => typeof a === 'string')
    if (command && args.length) command = command + ' ' + args.join(' ')
    else if (!command) command = args.join(' ')
  }
  if (type === 'stdio' && !command) return null
  if (type !== 'stdio' && !url) return null
  return {
    name,
    type,
    command: type === 'stdio' ? command : '',
    url: type === 'stdio' ? '' : url,
    enabled: raw.disabled !== true,
    env: raw.env && typeof raw.env === 'object' ? raw.env : undefined,
    headers: raw.headers && typeof raw.headers === 'object' ? raw.headers : undefined,
  }
}

export function collectMcpServersFor(ids) {
  const sources = []
  const list = ids ? IMPORT_SOURCE_DEFAULTS.filter((s) => ids.includes(s.id)) : IMPORT_SOURCE_DEFAULTS
  for (const def of list) {
    const eff = getEffectiveSource(def.id)
    const servers = []
    for (const f of eff.configFiles) {
      const cfg = readJsonIfExists(f)
      if (!cfg) continue
      // 兼容对象 { mcpServers: { name: cfg } }、数组 [{ name, ... }] 两种形态
      const rawMap = cfg.mcpServers || cfg.experimental?.mcpServers
      if (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) {
        for (const [name, raw] of Object.entries(rawMap)) {
          const n = normalizeMcpEntry(name, raw)
          if (n) servers.push(n)
        }
      } else if (Array.isArray(rawMap)) {
        for (const item of rawMap) {
          const n = normalizeMcpEntry(item && item.name, item)
          if (n) servers.push(n)
        }
      } else if (Array.isArray(cfg)) {
        for (const item of cfg) {
          const n = normalizeMcpEntry(item && item.name, item)
          if (n) servers.push(n)
        }
      }
    }
    if (servers.length) sources.push({ id: eff.id, label: eff.label, servers })
  }
  return sources
}

export async function scanImportableSkillsFor(ids) {
  const sources = []
  const list = ids ? IMPORT_SOURCE_DEFAULTS.filter((s) => ids.includes(s.id)) : IMPORT_SOURCE_DEFAULTS
  for (const def of list) {
    const eff = getEffectiveSource(def.id)
    const foundDirs = []
    for (const dir of eff.skillDirs) {
      let entries
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      foundDirs.push({ dir, entries })
    }
    const skills = []
    for (const { dir, entries } of foundDirs) {
      for (const e of entries) {
        if (!e.isDirectory()) continue
        const skillDir = path.join(dir, e.name)
        const skillFile = path.join(skillDir, 'SKILL.md')
        let content = ''
        try {
          content = await fsp.readFile(skillFile, 'utf-8')
        } catch {
          continue
        }
        const fm = parseSkillFrontmatter(content)
        skills.push({
          name: fm.name || e.name,
          dirName: e.name,
          description: fm.description || '',
          path: skillDir,
        })
      }
    }
    if (skills.length) sources.push({ id: eff.id, label: eff.label, path: eff.skillDirs.join(', '), skills })
  }
  return sources
}

// 返回所有 Agent 的来源定义（含生效路径与是否覆盖标记），供前端编辑
export function listImportSourceDefs() {
  return IMPORT_SOURCE_DEFAULTS.map((def) => {
    const eff = getEffectiveSource(def.id)
    return {
      id: eff.id,
      label: eff.label,
      configFiles: eff.configFiles,
      skillDirs: eff.skillDirs,
      isOverridden: eff.isOverridden,
    }
  })
}

async function copyDirRecursive(src, dest) {
  await fsp.mkdir(dest, { recursive: true })
  const entries = await fsp.readdir(src, { withFileTypes: true })
  for (const e of entries) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) await copyDirRecursive(s, d)
    else await fsp.copyFile(s, d)
  }
}

// 跨平台软链接：Windows 下目录用 junction（普通用户免提权），其余用符号链接
async function createLink(src, dest) {
  const type = process.platform === 'win32' ? 'junction' : 'dir'
  await fsp.symlink(src, dest, type)
}

// 保存/恢复用户自定义导入路径（持久化覆盖层）
export function setImportPathOverride(agentId, configFiles, skillDirs) {
  const def = IMPORT_SOURCE_DEFAULTS.find((s) => s.id === agentId)
  if (!def) return null
  const normFiles = Array.isArray(configFiles)
    ? configFiles.map((s) => String(s).trim()).filter(Boolean)
    : def.configFiles
  const normDirs = Array.isArray(skillDirs)
    ? skillDirs.map((s) => String(s).trim()).filter(Boolean)
    : def.skillDirs
  importPathOverrides[agentId] = { configFiles: normFiles, skillDirs: normDirs }
  saveImportPathOverrides()
  return getEffectiveSource(agentId)
}

export function clearImportPathOverride(agentId) {
  if (agentId && importPathOverrides[agentId]) {
    delete importPathOverrides[agentId]
    saveImportPathOverrides()
  }
  return agentId ? getEffectiveSource(agentId) : null
}

// 把选中的技能软链接到项目 skills/ 目录（校验源路径必须属于已声明的 Agent 目录）
export async function importSkills(items) {
  const allowedRoots = IMPORT_SOURCE_DEFAULTS.flatMap((def) => getEffectiveSource(def.id).skillDirs)
  const projectSkills = join(projectRootDir, 'skills')
  const results = []
  for (const it of items) {
    const src = it && typeof it.path === 'string' ? it.path : ''
    const dirName = (it && it.dirName || '').trim()
    if (!src || !dirName || !allowedRoots.some((root) => src === root || src.startsWith(root + path.sep))) {
      results.push({ name: dirName || '(无效)', status: 'error', error: '源路径不在已扫描的 Agent 目录内' })
      continue
    }
    const dest = path.join(projectSkills, dirName)
    if (fs.existsSync(dest)) {
      results.push({ name: dirName, status: 'exists', target: dest })
      continue
    }
    try {
      // 创建软链接（或 Windows junction），来源更新时项目内自动跟随
      await createLink(src, dest)
      results.push({ name: dirName, status: 'imported', target: dest })
    } catch (e) {
      results.push({ name: dirName, status: 'error', error: String(e.message || e) })
    }
  }
  return results
}

export { copyDirRecursive }
