import { createPatch } from 'diff'

// 将 before/after 文本生成统一 diff 的可渲染行列表。
// 返回 [{ type: 'hunk'|'add'|'del'|'ctx', text }]
//  type=hunk: @@ 行号标记；add: 新增行(+); del: 删除行(-); ctx: 上下文行(空格)
export function buildDiffRows(filePath, before, after) {
  const patchText = createPatch(
    filePath || 'file',
    before || '',
    after || '',
    '改动前',
    '改动后',
    { context: 3 }
  )
  const lines = patchText.split('\n')
  const rows = []
  let inHunk = false
  for (const line of lines) {
    if (
      line.startsWith('+++') ||
      line.startsWith('---') ||
      line.startsWith('Index:') ||
      line.startsWith('===')
    )
      continue
    if (line.startsWith('@@')) {
      inHunk = true
      rows.push({ type: 'hunk', text: line })
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('+')) rows.push({ type: 'add', text: line.slice(1) })
    else if (line.startsWith('-')) rows.push({ type: 'del', text: line.slice(1) })
    else if (line.startsWith(' ')) rows.push({ type: 'ctx', text: line.slice(1) })
    else rows.push({ type: 'ctx', text: line })
  }
  return rows
}
