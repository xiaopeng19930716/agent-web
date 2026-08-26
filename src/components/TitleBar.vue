<template>
  <div v-if="visible" class="title-bar" @dblclick="onToggleMax">
    <div class="title-bar__drag" />
    <div class="title-bar__title">{{ title }}</div>
    <div class="title-bar__actions">
      <button class="tb-btn" title="最小化" @click="minimize">
        <Minus :size="14" />
      </button>
      <button class="tb-btn" title="最大化/还原" @click="toggleMax">
        <component :is="isMax ? Square : Copy" :size="13" />
      </button>
      <button class="tb-btn tb-btn--close" title="关闭" @click="close">
        <X :size="14" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { Minus, X, Square, Copy } from 'lucide-vue-next'

const visible = ref(false)
const isMax = ref(false)
const title = ref('Code Agent')

onMounted(() => {
  visible.value = !!(window.codeAgent && window.codeAgent.isElectron)
  if (visible.value && window.codeAgent.window) {
    // 监听窗口最大化状态变化（双击标题栏等）
    window.addEventListener('resize', syncMax)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', syncMax)
})

function syncMax() {
  // 通过 document 是否铺满来粗略判断；更准确可经由主进程回传，这里够用
  isMax.value = window.outerWidth === window.screen.availWidth && window.outerHeight === window.screen.availHeight
}

function minimize() {
  window.codeAgent?.window?.minimize?.()
}
function toggleMax() {
  window.codeAgent?.window?.maximize?.()
  // 状态由 resize 事件同步
  setTimeout(syncMax, 60)
}
function onToggleMax() {
  toggleMax()
}
function close() {
  window.codeAgent?.window?.close?.()
}
</script>

<style scoped lang="less">
.title-bar {
  height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  background: var(--color-bg);
  border-bottom: 1px solid @color-border;
  user-select: none;
  position: relative;
  z-index: 50;
}
.title-bar__drag {
  flex: 1;
  height: 100%;
  -webkit-app-region: drag;
}
.title-bar__title {
  position: absolute;
  left: 0;
  right: 120px;
  text-align: center;
  font-size: 12px;
  color: @color-text-muted;
  pointer-events: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.title-bar__actions {
  display: flex;
  height: 100%;
}
.tb-btn {
  width: 46px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: @color-text;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;

  &:hover {
    background: @color-bg-subtle;
  }
  &--close:hover {
    background: #e81123;
    color: #fff;
  }
}
</style>
