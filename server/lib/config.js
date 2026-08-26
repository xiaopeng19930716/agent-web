import fs from 'fs'
import os from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '..', '.env') })

// 百炼云兼容 baseURL 作为供应商的默认地址（当用户未自定义 baseURL 时回退）
export const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
// 注意：API Key / 模型 URL 一律由用户在设置面板写入服务端配置文件（~/.code-agent/models.json），
// 不读取环境变量，避免密钥泄露。以下默认值仅为回退，不来自 .env。
export const API_KEY = ''
export const DEFAULT_MODEL = 'qwen-coder-plus'
export const PORT = process.env.PORT || 37821

// 用户全局存储统一放在 ~/.code-agent 下，按职责分目录：
//   config/  —— 配置文件（models.json / mcp.json / settings.json / import-paths.json）
//   data/    —— 数据文件（sessions.json / projects.json / upload/）
// 网页版与 Electron 版共用；CODE_AGENT_DATA_DIR 可整体覆盖根目录（供 Electron 测试/便携化）。
export const CODE_AGENT_ROOT = process.env.CODE_AGENT_DATA_DIR
  ? join(process.env.CODE_AGENT_DATA_DIR)
  : join(os.homedir(), '.code-agent')
export const CONFIG_DIR = join(CODE_AGENT_ROOT, 'config')
export const DATA_DIR = join(CODE_AGENT_ROOT, 'data')
export const MODELS_FILE = join(CONFIG_DIR, 'models.json')
export const MCP_FILE = join(CONFIG_DIR, 'mcp.json')
export const SETTINGS_FILE = join(CONFIG_DIR, 'settings.json')

// 读取某个配置文件，缺失或损坏返回 null（调用方据此回退默认值）
export function readConfigFile(file) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    }
  } catch {
    // 损坏则忽略，回退默认
  }
  return null
}

// 写入某个配置文件（仅接受对象）
export function writeConfigFile(file, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return false
  }
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(body, null, 2))
  return true
}
