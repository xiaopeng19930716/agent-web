import fs from 'fs'
import os from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '..', '.env') })

export const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
export const API_KEY = process.env.DASHSCOPE_API_KEY
export const DEFAULT_MODEL = process.env.DASHSCOPE_MODEL || 'qwen-coder-plus'
export const PORT = process.env.PORT || 3001

// 用户全局配置（持久化到用户主目录，避免存于浏览器 localStorage）
// 模型相关配置与 MCP 配置独立存储，便于分离管理；其余（skills 等）留在 settings.json
export const SETTINGS_DIR = join(os.homedir(), '.code-agent')
export const MODELS_FILE = join(SETTINGS_DIR, 'models.json')
export const MCP_FILE = join(SETTINGS_DIR, 'mcp.json')
export const SETTINGS_FILE = join(SETTINGS_DIR, 'settings.json')

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
  fs.mkdirSync(SETTINGS_DIR, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(body, null, 2))
  return true
}
