import {
  ACESFilmicToneMapping, Box3, DirectionalLight, HemisphereLight, MathUtils,
  Object3D, PerspectiveCamera, PMREMGenerator, Scene, Spherical, SRGBColorSpace,
  Texture, TOUCH, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { getFufuDistance } from './fufu'

/** An independent camera; closing never moves or disposes the room's objects. */
export class FufuViewer {
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(32, 1, 0.01, 10)
  private readonly renderer: WebGLRenderer
  private readonly controls: OrbitControls
  private readonly environment: Texture
  private readonly observer: ResizeObserver
  private readonly lifecycle = new AbortController()
  private readonly size: Vector3
  private readonly host: HTMLElement
  private raf = 0
  private disposed = false

  constructor(host: HTMLElement, model: Object3D, onError: () => void) {
    this.host = host
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.12
    this.renderer.setClearColor(0x000000, 0)
    const canvas = this.renderer.domElement
    canvas.tabIndex = 0
    canvas.setAttribute('aria-label', 'fufu 三维展示，拖动或方向键旋转，滚轮或加减键缩放，Home 复位')
    canvas.setAttribute('aria-describedby', 'fufu-gestures')
    host.appendChild(canvas)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enablePan = false
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.rotateSpeed = 0.65
    this.controls.zoomSpeed = 0.65
    this.controls.touches.ONE = TOUCH.ROTATE
    this.controls.touches.TWO = TOUCH.DOLLY_ROTATE
    this.controls.addEventListener('change', this.requestRender)
    this.scene.add(model, new HemisphereLight('#eef9f5', '#667679', 2.2))
    const key = new DirectionalLight('#fff1dc', 3.2)
    key.position.set(-1, 2, 3)
    const fill = new DirectionalLight('#cfefed', 1.8)
    fill.position.set(2, 0.5, -1)
    this.scene.add(key, fill)
    const pmrem = new PMREMGenerator(this.renderer)
    const environmentScene = new RoomEnvironment()
    this.environment = pmrem.fromScene(environmentScene, 0.04).texture
    this.scene.environment = this.environment
    this.scene.environmentIntensity = 0.35
    environmentScene.dispose()
    pmrem.dispose()
    this.size = new Box3().setFromObject(model).getSize(new Vector3())
    const options = { signal: this.lifecycle.signal }
    canvas.addEventListener('keydown', this.onKeyDown, options)
    canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }), options)
    canvas.addEventListener('contextmenu', event => event.preventDefault(), options)
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); onError() }, options)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(this.raf); this.raf = 0 }
      else this.requestRender()
    }, options)
    this.observer = new ResizeObserver(this.resize)
    this.observer.observe(host)
    this.resize()
    this.reset()
  }

  reset = () => {
    this.controls.enableDamping = false
    this.controls.update()
    this.controls.enableDamping = true
    this.camera.position.set(0, 0.025, getFufuDistance(this.size, this.camera.aspect))
    this.controls.target.set(0, 0, 0)
    this.controls.update()
    this.requestRender()
  }

  private resize = () => {
    // Use layout dimensions; the entry animation temporarily scales the stage.
    const width = this.host.clientWidth, height = this.host.clientHeight
    if (!width || !height) return
    const previousAspect = this.camera.aspect
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    // Preserve rotation and relative zoom when rotating a phone or resizing a window.
    this.camera.position.multiplyScalar(getFufuDistance(this.size, this.camera.aspect) / getFufuDistance(this.size, previousAspect))
    const distance = getFufuDistance(this.size, this.camera.aspect)
    this.controls.minDistance = Math.max(this.size.length() * 0.60, distance * 0.58)
    this.controls.maxDistance = distance * 2.0
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(width, height)
    this.requestRender()
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return
    if (event.key === 'Home') { event.preventDefault(); this.reset(); return }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(event.key)) return
    event.preventDefault()
    const position = new Spherical().setFromVector3(this.camera.position)
    if (event.key === 'ArrowLeft') position.theta -= 0.12
    if (event.key === 'ArrowRight') position.theta += 0.12
    if (event.key === 'ArrowUp') position.phi -= 0.12
    if (event.key === 'ArrowDown') position.phi += 0.12
    if (event.key === '+' || event.key === '=') position.radius *= 0.9
    if (event.key === '-' || event.key === '_') position.radius *= 1.1
    position.makeSafe()
    position.radius = MathUtils.clamp(position.radius, this.controls.minDistance, this.controls.maxDistance)
    this.camera.position.setFromSpherical(position)
    this.requestRender()
  }

  private requestRender = () => {
    if (!this.raf && !this.disposed && !document.hidden) this.raf = requestAnimationFrame(this.render)
  }
  private render = () => {
    this.raf = 0
    if (this.disposed || document.hidden) return
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.lifecycle.abort()
    this.observer.disconnect()
    this.controls.removeEventListener('change', this.requestRender)
    this.controls.dispose()
    this.environment.dispose()
    // Model geometry/materials/textures belong to RoomViewer and are shared.
    this.scene.clear()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}
