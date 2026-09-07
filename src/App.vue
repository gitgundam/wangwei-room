<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import RoomIcon from './components/RoomIcon.vue'
import { RoomError, RoomViewer } from './scene/room'
import type { ActiveView, RoomView } from './scene/room-state'

const host = ref<HTMLDivElement>()
const phase = ref<'loading' | 'ready' | 'error'>('loading')
const progress = ref<number | null>(null)
const stage = ref<'download' | 'prepare'>('download')
const errorMessage = ref('')
const lightsOn = ref(true)
const screenOn = ref(true)
const activeView = ref<ActiveView>('overview')
const helpOpen = ref(false)
const base = import.meta.env.BASE_URL
const ready = computed(() => phase.value === 'ready')
const percent = computed(() => progress.value === null ? null : Math.round(progress.value * 100))
const viewLabel = computed(() => ({ overview: '整体剖切', desk: '书桌视角', custom: '自由视角' })[activeView.value])
let viewer: RoomViewer | undefined
let generation = 0

async function startViewer() {
  const run = ++generation
  viewer?.dispose()
  viewer = undefined
  phase.value = 'loading'
  progress.value = null
  stage.value = 'download'
  errorMessage.value = ''
  lightsOn.value = true
  screenOn.value = true
  activeView.value = 'overview'
  if (!host.value) return
  try {
    const candidate = new RoomViewer(host.value, {
      onProgress: (value, step) => {
        if (run !== generation) return
        progress.value = value
        stage.value = step
      },
      onScreenChange: (value) => { screenOn.value = value },
      onViewChange: (value) => { activeView.value = value },
      onFatalError: (error) => {
        if (run !== generation) return
        errorMessage.value = error.message
        phase.value = 'error'
        viewer?.dispose()
        viewer = undefined
      },
    })
    viewer = candidate
    await candidate.load(`${base}models/room.glb`)
    if (run !== generation || viewer !== candidate) return
    progress.value = 1
    phase.value = 'ready'
  } catch (error) {
    if (run !== generation || (error instanceof DOMException && error.name === 'AbortError')) return
    console.error('房间加载失败', error)
    viewer?.dispose()
    viewer = undefined
    errorMessage.value = error instanceof RoomError ? error.message : '房间暂时未能加载。请检查网络连接，然后重试。'
    phase.value = 'error'
  }
}

function changeView(view: RoomView) {
  if (ready.value) viewer?.setView(view)
}
function toggleLights() {
  if (!ready.value) return
  lightsOn.value = !lightsOn.value
  viewer?.setLightsPower(lightsOn.value)
}
function toggleScreen() {
  if (ready.value) viewer?.setScreenPower(!screenOn.value)
}
onMounted(startViewer)
onBeforeUnmount(() => {
  generation++
  viewer?.dispose()
})
</script>

<template>
  <main class="room-page" :class="{ 'lights-off': !lightsOn && ready }">
    <header class="page-header">
      <div class="room-title">
        <span class="home-mark"><RoomIcon name="home" /></span>
        <div>
          <h1>王威的房间</h1>
          <p>拖动看看，点击屏幕试试。</p>
        </div>
      </div>
      <div class="view-indicator" aria-live="polite">
        <span class="status-dot" :class="{ live: ready }"></span>
        {{ ready ? viewLabel : phase === 'error' ? '加载中断' : '正在准备' }}
      </div>
    </header>

    <section class="scene-area" aria-label="房间模型" :aria-busy="phase === 'loading'">
      <div ref="host" class="scene-canvas" :class="{ visible: ready }" :inert="!ready"></div>
      <div v-if="!ready" class="scene-fallback" :class="{ failed: phase === 'error' }">
        <div class="load-panel">
          <template v-if="phase === 'loading'">
            <span class="loading-symbol"><RoomIcon name="home" /></span>
            <h2>{{ stage === 'prepare' ? '正在整理房间' : '小屋加载中' }}</h2>
            <p>{{ stage === 'prepare' ? '准备纹理与灯光，很快就好。' : '首次打开需要加载模型，请稍等片刻。' }}</p>
            <div class="progress-track" role="progressbar" aria-label="房间加载进度" :aria-valuenow="percent ?? undefined" aria-valuemin="0" aria-valuemax="100">
              <span :class="{ indeterminate: percent === null }" :style="{ width: percent === null ? '32%' : `${percent}%` }"></span>
            </div>
            <div class="progress-caption" role="status">{{ percent === null ? '正在连接' : `${percent}%` }}<span>{{ stage === 'prepare' ? '准备显示' : '加载房间模型' }}</span></div>
          </template>
          <template v-else>
            <span class="loading-symbol"><RoomIcon name="home" /></span>
            <h2>房间暂时无法显示</h2>
            <p role="alert">{{ errorMessage }}</p>
            <button class="retry-button" @click="startViewer"><RoomIcon name="retry" />重新加载</button>
          </template>
        </div>
      </div>
    </section>

    <footer class="scene-footer">
      <div class="control-bar" aria-label="房间控制">
        <div class="view-controls" role="group" aria-label="快捷视角">
          <button class="view-button" :class="{ selected: activeView === 'overview' }" :aria-pressed="activeView === 'overview'" :disabled="!ready" @click="changeView('overview')">
            <RoomIcon name="home" /><span>全景</span>
          </button>
          <button class="view-button" :class="{ selected: activeView === 'desk' }" :aria-pressed="activeView === 'desk'" :disabled="!ready" @click="changeView('desk')">
            <RoomIcon name="desk" /><span>书桌</span>
          </button>
          <button class="reset-button" title="重置视角" aria-label="重置视角" :disabled="!ready" @click="changeView('overview')"><RoomIcon name="reset" /></button>
        </div>
        <span class="control-divider" aria-hidden="true"></span>
        <div class="power-controls" role="group" aria-label="生活小互动">
          <button class="power-button" :class="{ on: lightsOn }" role="switch" :aria-checked="lightsOn" aria-label="房间灯光" :disabled="!ready" @click="toggleLights">
            <RoomIcon name="light" />
            <span class="power-copy"><span>房间灯光</span><small aria-hidden="true">{{ lightsOn ? '暖灯已开启' : '灯光已关闭' }}</small></span>
            <span class="switch-track" aria-hidden="true"><span></span></span>
          </button>
          <button class="power-button" :class="{ on: screenOn }" role="switch" :aria-checked="screenOn" aria-label="电脑屏幕" :disabled="!ready" @click="toggleScreen">
            <RoomIcon name="screen" />
            <span class="power-copy"><span>电脑屏幕</span><small aria-hidden="true">{{ screenOn ? '屏幕亮着' : '屏幕已关闭' }}</small></span>
            <span class="switch-track" aria-hidden="true"><span></span></span>
          </button>
        </div>
      </div>
      <div class="footer-meta">
        <p id="scene-help" class="gesture-hint"><RoomIcon name="drag" /><span class="desktop-hint">拖拽旋转<span class="hint-dot">·</span>滚轮缩放<span class="hint-dot">·</span>右键平移</span><span class="touch-hint">单指旋转<span class="hint-dot">·</span>双指缩放与平移</span></p>
        <button class="help-button" :aria-expanded="helpOpen" aria-controls="help-panel" @click="helpOpen = !helpOpen">操作说明<span aria-hidden="true">{{ helpOpen ? '−' : '+' }}</span></button>
      </div>
      <aside v-if="helpOpen" id="help-panel" class="help-panel">
        <button class="close-help" aria-label="关闭操作说明" @click="helpOpen = false">×</button>
        <h2>随手逛逛你的小屋</h2>
        <p>拖动房间调整角度，滚轮或双指缩放。靠近你的墙面会自动隐藏。</p>
        <p>切到「书桌」，可以直接点击显示器开关屏幕。底部两个开关也能控制灯光和屏幕。</p>
        <p class="keyboard-help">键盘：聚焦模型后，用方向键旋转，＋ / − 缩放，Home 重置视角。</p>
      </aside>
    </footer>
    <span class="sr-only" role="status" aria-live="polite">{{ ready ? `房间灯光${lightsOn ? '开启' : '关闭'}，电脑屏幕${screenOn ? '开启' : '关闭'}` : '' }}</span>
  </main>
</template>
