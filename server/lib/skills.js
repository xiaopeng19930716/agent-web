import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Skills 扫描（多候选目录合并，只读）
export function getCandidateSkillDirs() {
  const home = os.homedir()
  const projectRoot = join(__dirname, '..', '..')
  return [
    join(projectRoot, 'skills'),
    join(home, 'skills'),
    join(home, '.agents', 'skills'),
    join(home, '.claude', 'skills'),
    join(home, '.codebuddy', 'skills'),
  ]
}

export function parseSkillFrontmatter(content) {
  const m = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return { name: '', description: '' }
  const body = m[1]
  const nameMatch = body.match(/^name\s*:\s*(.+)$/m)
  let description = ''
  const lines = body.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const d = lines[i].match(/^description\s*:\s*(.*)$/)
    if (d) {
      const first = d[1].trim().replace(/^['"]|['"]$/g, '')
      if (first) {
        description = first
      } else {
        const rest = []
        for (let j = i + 1; j < lines.length; j++) {
          if (/^\w+\s*:/.test(lines[j])) break
          rest.push(lines[j].trim())
        }
        description = rest.filter(Boolean).join(' ')
      }
      break
    }
  }
  return {
    name: nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : '',
    description,
  }
}

export async function scanSkills() {
  const results = []
  const seen = new Set()
  for (const dir of getCandidateSkillDirs()) {
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue // 目录不存在或无权限：静默跳过
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const skillDir = path.join(dir, e.name)
      const skillFile = path.join(skillDir, 'SKILL.md')
      let content = ''
      try {
        content = await fsp.readFile(skillFile, 'utf-8')
      } catch {
        continue // 无 SKILL.md：不是技能，跳过
      }
      const id = path.basename(dir) + '/' + e.name
      if (seen.has(id)) continue
      seen.add(id)
      const fm = parseSkillFrontmatter(content)
      results.push({
        id,
        name: fm.name || e.name,
        description: fm.description || '',
        path: skillDir,
        sourceDir: dir,
      })
    }
  }
  return results
}

// 根据技能 id（如 "skills/agent-browser"）读取对应 SKILL.md 的完整内容
// 返回 Map<id, content>；未找到或读取失败则跳过
export async function loadSkillContents(ids) {
  const idSet = new Set(Array.isArray(ids) ? ids : [])
  if (!idSet.size) return new Map()
  const out = new Map()
  for (const dir of getCandidateSkillDirs()) {
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    const dirBase = path.basename(dir)
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const id = dirBase + '/' + e.name
      if (!idSet.has(id)) continue
      const skillFile = path.join(dir, e.name, 'SKILL.md')
      try {
        const content = await fsp.readFile(skillFile, 'utf-8')
        out.set(id, content)
      } catch {
        // 无 SKILL.md：跳过
      }
    }
  }
  return out
}
