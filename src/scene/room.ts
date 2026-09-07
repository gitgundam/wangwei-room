import {
  ACESFilmicToneMapping, AmbientLight, BufferGeometry, DirectionalLight, HemisphereLight,
  Material, MathUtils, Mesh, Object3D, PCFSoftShadowMap,
  PerspectiveCamera, PlaneGeometry, PMREMGenerator, PointLight, Raycaster,
  Scene, ShadowMaterial, Spherical, SRGBColorSpace, Texture, TOUCH, Vector2, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { getViewPose, RoomBindings, TapGesture, type ActiveView, type RoomView } from './room-state'

export class RoomError extends Error {
  readonly kind: 'webgl' | 'load'
  constructor(kind: 'webgl' | 'load', message: string) {
    super(message)
    this.kind = kind
  }
}

interface Callbacks {
  onProgress: (progress: number | null, stage: 'download' | 'prepare') => void
  onScreenChange: (on: boolean) => void
  onViewChange: (view: ActiveView) => void
  onFatalError: (error: RoomError) => void
}

type Transition = {
  start: number
  fromPosition: Vector3
  fromTarget: Vector3
  fromFov: number
  to: ReturnType<typeof getViewPose>
}

function disposeTree(root: Object3D) {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    geometries.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material)
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value)
    }
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
  const closedImages = new Set<ImageBitmap>()
  textures.forEach((texture) => {
    const bitmap = texture.source.data
    if (typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap && !closedImages.has(bitmap)) {
      bitmap.close()
      closedImages.add(bitmap)
    }
    texture.dispose()
  })
}

export class RoomViewer {
  private readonly container: HTMLElement
  private readonly callbacks: Callbacks
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(38, 1, 0.035, 100)
  private readonly renderer: WebGLRenderer
  private readonly controls: OrbitControls
  private readonly lifecycle = new AbortController()
  private readonly resizeObserver: ResizeObserver
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  private readonly keyLight = new DirectionalLight('#fff1da', 3.0)
  private readonly roomLight = new PointLight('#ffe2b6', 8.5, 8, 2)
  private readonly deskLight = new PointLight('#ffebce', 2.5, 4, 2)
  private readonly environment: Texture
  private readonly raycaster = new Raycaster()
  private readonly tap = new TapGesture()
  private readonly pointer = new Vector2()
  private readonly targetBeforeClamp = new Vector3()
  private bindings: RoomBindings | null = null
  private raf = 0
  private disposed = false
  private transition: Transition | null = null
  private activeView: ActiveView = 'overview'
  private lightsOn = true
  private lightLevel = 1
  private lastFrame = 0

  constructor(container: HTMLElement, callbacks: Callbacks) {
    this.container = container
    this.callbacks = callbacks
    try {
      this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      throw new RoomError('webgl', '当前浏览器无法显示 3D 房间。请使用支持 WebGL 2 的浏览器，或开启图形加速后重试。')
    }
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.10
    this.renderer.setClearColor('#e8e7e3', 0)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    const canvas = this.renderer.domElement
    canvas.tabIndex = 0
    canvas.setAttribute('aria-label', '互动房间：拖拽旋转，滚轮缩放。键盘方向键旋转，加减键缩放，Home 键重置视角。')
    canvas.setAttribute('aria-describedby', 'scene-help')
    container.appendChild(canvas)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.10
    this.controls.rotateSpeed = 0.6
    this.controls.zoomSpeed = 0.7
    this.controls.panSpeed = 0.6
    this.controls.minDistance = 0.70
    this.controls.maxDistance = 28
    this.controls.minPolarAngle = 0.14
    this.controls.maxPolarAngle = Math.PI / 2 - 0.08
    this.controls.touches.ONE = TOUCH.ROTATE
    this.controls.touches.TWO = TOUCH.DOLLY_PAN
    this.controls.enabled = false
    this.controls.addEventListener('change', this.requestRender)
    this.controls.addEventListener('start', this.onControlStart)

    this.scene.add(new HemisphereLight('#e8eef5', '#a39989', 0.65), new AmbientLight('#edf0ed', 0.13))
    this.keyLight.position.set(3, 7, -4)
    this.keyLight.target.position.set(0, 0.5, 0)
    this.keyLight.castShadow = true
    this.keyLight.shadow.mapSize.setScalar(window.innerWidth < 768 ? 1024 : 2048)
    Object.assign(this.keyLight.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 18 })
    this.keyLight.shadow.bias = -0.0003
    this.keyLight.shadow.normalBias = 0.016
    this.roomLight.position.set(0.08, 2.50, 0.38)
    this.deskLight.position.set(-1.05, 2.20, 1.5)
    this.scene.add(this.keyLight, this.keyLight.target, this.roomLight, this.deskLight)

    const pmrem = new PMREMGenerator(this.renderer)
    const environmentScene = new RoomEnvironment()
    this.environment = pmrem.fromScene(environmentScene, 0.04).texture
    this.scene.environment = this.environment
    this.scene.environmentIntensity = 0.24
    environmentScene.dispose()
    pmrem.dispose()

    const ground = new Mesh(new PlaneGeometry(200, 200), new ShadowMaterial({
      color: '#526052', opacity: 0.17, depthWrite: false,
    }))
    ground.name = '网页展示地面'
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.145
    ground.receiveShadow = true
    this.scene.add(ground)

    const options = { signal: this.lifecycle.signal }
    canvas.addEventListener('pointerdown', this.onPointerDown, options)
    canvas.addEventListener('pointermove', this.onPointerMove, options)
    canvas.addEventListener('pointerup', this.onPointerUp, options)
    canvas.addEventListener('pointercancel', () => this.tap.cancel(), options)
    canvas.addEventListener('keydown', this.onKeyDown, options)
    canvas.addEventListener('contextmenu', (event) => event.preventDefault(), options)
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      if (!this.disposed) callbacks.onFatalError(new RoomError('webgl', '图形显示已中断，请重新加载房间。'))
    }, options)
    document.addEventListener('visibilitychange', this.onVisibilityChange, options)
    this.resizeObserver = new ResizeObserver(this.onResize)
    this.resizeObserver.observe(container)
    this.onResize()
  }

  async load(url: string) {
    const signal = this.lifecycle.signal
    const response = await fetch(url, { signal })
    if (!response.ok) throw new RoomError('load', `模型文件加载失败（${response.status}），请重试。`)
    const total = Number(response.headers.get('content-length'))
    let data: ArrayBuffer
    if (response.body) {
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let loaded = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          loaded += value.byteLength
          this.callbacks.onProgress(total > 0 ? Math.min(0.90, loaded / total * 0.90) : null, 'download')
        }
      } finally { reader.releaseLock() }
      const bytes = new Uint8Array(loaded)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      data = bytes.buffer
    } else {
      data = await response.arrayBuffer()
    }
    signal.throwIfAborted()
    this.callbacks.onProgress(0.92, 'prepare')
    const gltf = await new GLTFLoader().parseAsync(data, '')
    if (this.disposed) {
      disposeTree(gltf.scene)
      throw new DOMException('房间加载已取消', 'AbortError')
    }
    this.scene.add(gltf.scene)
    this.bindings = new RoomBindings(gltf.scene)
    this.bindings.meshes.forEach((mesh) => {
      mesh.castShadow = true
      mesh.receiveShadow = true
    })
    this.bindings.screen.castShadow = false
    this.controls.enabled = true
    this.setView('overview', false)
    this.callbacks.onProgress(0.98, 'prepare')
    await this.renderer.compileAsync(this.scene, this.camera)
    signal.throwIfAborted()
    this.requestRender()
  }

  setScreenPower(on: boolean) {
    if (!this.bindings || this.disposed) return
    this.bindings.setScreenPower(on)
    this.callbacks.onScreenChange(on)
    this.requestRender()
  }

  setLightsPower(on: boolean) {
    this.lightsOn = on
    this.requestRender()
  }

  setView(view: RoomView, animate = true) {
    if (!this.bindings || this.disposed) return
    this.transition = null
    // Flush momentum so switching views cannot inherit a previous drag.
    this.controls.enableDamping = false
    this.controls.update()
    this.controls.enableDamping = true
    const pose = getViewPose(view, this.bindings.bounds, this.camera.aspect)
    const overview = getViewPose('overview', this.bindings.bounds, this.camera.aspect)
    this.controls.maxDistance = Math.max(22, overview.position.distanceTo(overview.target) * 1.7)
    if (animate && !this.reducedMotion.matches) {
      this.transition = {
        start: performance.now(), fromPosition: this.camera.position.clone(),
        fromTarget: this.controls.target.clone(), fromFov: this.camera.fov, to: pose,
      }
    } else {
      this.camera.position.copy(pose.position)
      this.controls.target.copy(pose.target)
      this.camera.fov = pose.fov
      this.camera.updateProjectionMatrix()
      this.controls.update()
      this.bindings.updateCutaway(this.camera.position)
    }
    this.activeView = view
    this.callbacks.onViewChange(view)
    this.requestRender()
  }

  private onControlStart = () => {
    this.transition = null
    this.activeView = 'custom'
    this.callbacks.onViewChange('custom')
  }

  private onResize = () => {
    if (this.disposed) return
    const { width, height } = this.container.getBoundingClientRect()
    if (width < 1 || height < 1) return
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1.25 : 1.75))
    this.renderer.setSize(width, height)
    if (this.activeView !== 'custom') this.setView(this.activeView, false)
    this.requestRender()
  }

  private requestRender = () => {
    if (this.disposed || this.raf || document.hidden) return
    this.raf = requestAnimationFrame(this.render)
  }

  private render = (time: number) => {
    this.raf = 0
    if (this.disposed || document.hidden) return
    const delta = Math.min((time - this.lastFrame) / 1000 || 1 / 60, 0.05)
    this.lastFrame = time
    if (this.transition) {
      const t = Math.min((time - this.transition.start) / 700, 1)
      const eased = t * t * (3 - 2 * t)
      this.camera.position.lerpVectors(this.transition.fromPosition, this.transition.to.position, eased)
      this.controls.target.lerpVectors(this.transition.fromTarget, this.transition.to.target, eased)
      this.camera.fov = MathUtils.lerp(this.transition.fromFov, this.transition.to.fov, eased)
      this.camera.updateProjectionMatrix()
      if (t === 1) this.transition = null
      else this.requestRender()
    }
    const goal = this.lightsOn ? 1 : 0
    this.lightLevel = this.reducedMotion.matches ? goal : MathUtils.damp(this.lightLevel, goal, 12, delta)
    if (Math.abs(this.lightLevel - goal) < 0.002) this.lightLevel = goal
    else this.requestRender()
    this.keyLight.intensity = this.lightLevel * 3.0
    this.roomLight.intensity = this.lightLevel * 8.5
    this.deskLight.intensity = this.lightLevel * 2.5
    this.scene.environmentIntensity = 0.07 + this.lightLevel * 0.17
    this.controls.update(delta)
    this.clampCamera()
    this.bindings?.updateCutaway(this.camera.position)
    this.renderer.render(this.scene, this.camera)
  }

  private clampCamera() {
    this.targetBeforeClamp.copy(this.controls.target)
    this.controls.target.clamp(new Vector3(-1.5, 0.35, -2.3), new Vector3(1.7, 2.3, 2.3))
    this.camera.position.add(this.controls.target).sub(this.targetBeforeClamp)
    this.camera.position.y = Math.max(this.camera.position.y, 0.55)
    this.camera.lookAt(this.controls.target)
  }

  private onPointerDown = (event: PointerEvent) => {
    this.renderer.domElement.focus({ preventScroll: true })
    this.tap.down(event.pointerId, event.clientX, event.clientY, event.button)
  }
  private onPointerMove = (event: PointerEvent) => this.tap.move(event.pointerId, event.clientX, event.clientY)
  private onPointerUp = (event: PointerEvent) => {
    if (!this.tap.up(event.pointerId, event.clientX, event.clientY) || !this.bindings) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
    if (this.bindings.hitScreen(this.pointer, this.camera, this.raycaster)) this.setScreenPower(!this.bindings.screenOn)
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.bindings || event.altKey || event.metaKey || event.ctrlKey) return
    if (event.key === 'Home') {
      event.preventDefault()
      this.setView('overview')
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(event.key)) return
    event.preventDefault()
    this.onControlStart()
    const spherical = new Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target))
    if (event.key === 'ArrowLeft') spherical.theta -= 0.10
    if (event.key === 'ArrowRight') spherical.theta += 0.10
    if (event.key === 'ArrowUp') spherical.phi -= 0.08
    if (event.key === 'ArrowDown') spherical.phi += 0.08
    if (event.key === '+' || event.key === '=') spherical.radius *= 0.90
    if (event.key === '-' || event.key === '_') spherical.radius *= 1.10
    spherical.phi = MathUtils.clamp(spherical.phi, this.controls.minPolarAngle, this.controls.maxPolarAngle)
    spherical.radius = MathUtils.clamp(spherical.radius, this.controls.minDistance, this.controls.maxDistance)
    this.camera.position.copy(this.controls.target).add(new Vector3().setFromSpherical(spherical))
    this.requestRender()
  }

  private onVisibilityChange = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
      this.tap.cancel()
    } else this.requestRender()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.lifecycle.abort()
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    this.controls.removeEventListener('change', this.requestRender)
    this.controls.removeEventListener('start', this.onControlStart)
    this.controls.dispose()
    this.bindings?.dispose()
    disposeTree(this.scene)
    this.environment.dispose()
    this.keyLight.shadow.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
    this.scene.clear()
  }
}
