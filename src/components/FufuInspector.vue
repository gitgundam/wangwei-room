<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Object3D } from 'three'
import { FufuViewer } from '../scene/fufu-viewer'
import RoomIcon from './RoomIcon.vue'

const props = defineProps<{ model: Object3D }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
const host = ref<HTMLDivElement>()
const error = ref(false)
let viewer: FufuViewer | undefined
let previousOverflow = ''
let previousRootOverflow = ''

function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !dialog.value) return
  const targets = Array.from(dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), canvas[tabindex="0"]'))
  const first = targets[0], last = targets.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(() => {
  previousOverflow = document.body.style.overflow
  previousRootOverflow = document.documentElement.style.overflow
  document.body.style.overflow = 'hidden'
  document.documentElement.style.overflow = 'hidden'
  dialog.value?.showModal()
  try {
    viewer = new FufuViewer(host.value!, props.model, () => { error.value = true; viewer?.dispose() })
  } catch (cause) {
    console.error('fufu 展示加载失败', cause)
    error.value = true
  }
})
onBeforeUnmount(() => {
  viewer?.dispose()
  dialog.value?.close()
  document.body.style.overflow = previousOverflow
  document.documentElement.style.overflow = previousRootOverflow
})
</script>

<template>
  <dialog ref="dialog" class="fufu-inspector" aria-labelledby="fufu-title" @keydown="trapFocus" @cancel.prevent="emit('close')">
    <div class="fufu-toolbar">
      <button class="fufu-return" autofocus @click="emit('close')"><span aria-hidden="true">←</span> 返回房间</button>
      <button class="fufu-reset" aria-label="复位 fufu" title="复位 fufu" :disabled="error" @click="viewer?.reset()"><RoomIcon name="reset" /></button>
    </div>
    <div ref="host" class="fufu-stage">
      <p v-if="error" class="fufu-error" role="alert">展示暂时中断，请返回房间后再打开。</p>
    </div>
    <div class="fufu-caption">
      <span class="fufu-caption-line" aria-hidden="true"></span>
      <h2 id="fufu-title">小鹿送我的fufu ❤️</h2>
      <p id="fufu-gestures"><span class="desktop-hint">拖动旋转 · 滚轮缩放</span><span class="touch-hint">单指旋转 · 双指缩放</span></p>
    </div>
  </dialog>
</template>
