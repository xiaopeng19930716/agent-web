// 极简事件总线（用于跨组件解耦通知，例如侧边栏"添加项目"入口触发聊天面板弹窗）
const listeners = new Map()

export function onBus(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set())
  listeners.get(name).add(fn)
  return () => offBus(name, fn)
}

export function offBus(name, fn) {
  const set = listeners.get(name)
  if (set) set.delete(fn)
}

export function emitBus(name, payload) {
  const set = listeners.get(name)
  if (!set) return
  for (const fn of set) {
    try {
      fn(payload)
    } catch (e) {
      console.error('[bus]', name, e)
    }
  }
}
