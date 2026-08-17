import { reactive } from 'vue'

// 项目列表（来自后端，含 id/alias/path/modelId）
export const projects = reactive({ list: [] })
export const activeProjectId = reactive({ id: '' })

async function fetchProjects() {
  try {
    const resp = await fetch('/api/projects')
    if (resp.ok) {
      projects.list = await resp.json()
      if (activeProjectId.id && !projects.list.some((p) => p.id === activeProjectId.id)) {
        activeProjectId.id = ''
      }
    }
  } catch {
    // 后端未启动
  }
}

async function addProject({ alias, path, modelId }) {
  const resp = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias, path, modelId }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || '添加项目失败')
  }
  const p = await resp.json()
  projects.list.push(p)
  return p
}

async function removeProject(id) {
  const resp = await fetch('/api/projects/' + id, { method: 'DELETE' })
  if (resp.ok) {
    projects.list = projects.list.filter((p) => p.id !== id)
    if (activeProjectId.id === id) activeProjectId.id = ''
  }
}

function setActiveProject(id) {
  activeProjectId.id = id
}

export function getActiveProject() {
  return projects.list.find((p) => p.id === activeProjectId.id) || null
}

export { fetchProjects, addProject, removeProject, setActiveProject }
