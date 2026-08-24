// 富文本输入框的纯函数辅助（不依赖 Vue 响应式，操作原生 DOM）

// 标签图标
const TAG_ICON = {
  skill: "✦",
  mcp: "⌘",
  tool: "⚡",
  dir: "📁",
  file: "📄",
};
function tagIcon(kind) {
  return TAG_ICON[kind] || "·";
}

// 构建一个内联 chip 元素（contenteditable 内不可编辑的 span）
export function buildTagEl(t, onClose) {
  const span = document.createElement("span");
  span.className = "composer-tag";
  span.classList.add(`composer-tag--${t.kind}`);
  span.dataset.composerTag = t.kind;
  span.dataset.composerKey = t.key;
  span.dataset.composerLabel = t.label;
  span.contentEditable = "false";

  const icon = document.createElement("span");
  icon.className = "composer-tag__icon";
  icon.textContent = tagIcon(t.kind);
  span.appendChild(icon);

  const label = document.createElement("span");
  label.className = "composer-tag__label";
  label.textContent = (t.kind === "file" || t.kind === "dir" ? "@" : "/") + t.label;
  span.appendChild(label);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "composer-tag__close";
  close.title = "移除";
  close.textContent = "×";
  close.addEventListener("mousedown", (e) => e.preventDefault());
  close.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (span.parentNode) span.parentNode.removeChild(span);
    onClose && onClose(t);
  });
  span.appendChild(close);

  return span;
}

// 读取纯文本（仅 TEXT_NODE）
export function getComposerText(el) {
  if (!el) return "";
  let out = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent || "";
  }
  return out;
}

// 从 DOM 同步 token 列表
export function syncTokensFromDom(el) {
  if (!el) return [];
  const tokens = [];
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent)
        tokens.push({ type: "text", text: node.textContent });
    } else if (
      node.nodeType === Node.ELEMENT_NODE &&
      node.dataset?.composerTag
    ) {
      tokens.push({
        type: "tag",
        kind: node.dataset.composerTag,
        key: node.dataset.composerKey || "",
        label: node.dataset.composerLabel || "",
      });
    }
  }
  return tokens;
}

// 在触发符原位插入 tag
export function insertTagAtTrigger({ el, triggerRangeRef, t, onRemoveChip }) {
  if (!el) return { triggerRange: null };
  el.focus();
  const span = buildTagEl(t, onRemoveChip);
  const spaceAfter = document.createTextNode(" ");
  let insertRange;
  const triggerRange = triggerRangeRef.value;
  if (triggerRange) {
    const node = triggerRange.startContainer;
    if (!node || !el.contains(node) || node.nodeType !== Node.TEXT_NODE) {
      triggerRangeRef.value = null;
    } else {
      const r = document.createRange();
      r.setStart(node, triggerRange.startOffset);
      r.setEnd(node, node.textContent.length);
      insertRange = r;
    }
  }
  if (!insertRange) {
    insertRange = document.createRange();
    insertRange.selectNodeContents(el);
    insertRange.collapse(false);
  }
  const startNode = insertRange.startContainer;
  const startOff = insertRange.startOffset;
  if (startNode && startNode.nodeType === Node.TEXT_NODE && startOff > 0) {
    const before = startNode.textContent.slice(0, startOff);
    if (!/\s$/.test(before)) {
      const sp = document.createTextNode(" ");
      insertRange.insertNode(sp);
    }
  }
  insertRange.deleteContents();
  const insertPoint = document.createRange();
  if (insertRange.startContainer && el.contains(insertRange.startContainer)) {
    insertPoint.setStart(insertRange.startContainer, insertRange.startOffset);
  } else {
    insertPoint.selectNodeContents(el);
    insertPoint.collapse(false);
  }
  insertPoint.collapse(true);
  insertPoint.insertNode(span);
  insertPoint.setStartAfter(span);
  insertPoint.collapse(true);
  insertPoint.insertNode(spaceAfter);
  insertPoint.setStartAfter(spaceAfter);
  insertPoint.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(insertPoint);
  triggerRangeRef.value = null;
  return { triggerRange: null };
}

// 粘贴处理：去除富文本格式按纯文本插入；忽略图片
export function onPaste(e) {
  const cd = e.clipboardData || window.clipboardData;
  if (!cd) return;
  if (cd.files && cd.files.length) {
    e.preventDefault();
    return;
  }
  const text = cd.getData("text/plain");
  if (text) {
    e.preventDefault();
    document.execCommand("insertText", false, text);
  }
}

// 插入换行
export function insertNewline(el) {
  if (!el) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const br = document.createElement("br");
  range.deleteContents();
  range.insertNode(br);
  const after = document.createRange();
  after.setStartAfter(br);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
}
