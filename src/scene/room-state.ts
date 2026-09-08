import {
  Box3, Color, Float32BufferAttribute, Material, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera,
  Raycaster, Vector2, Vector3,
} from 'three'
import { createArtwork } from './artwork'
import { createFufuDisplay, FUFU, replaceShelfFufu } from './fufu'

export type RoomView = 'overview' | 'desk'
export type ActiveView = RoomView | 'custom'

export const PARTS = {
  screen: '显示器屏幕',
  ceiling: '天花与空调吊顶',
  east: '东侧墙与软包墙板',
  west: '西侧墙体与房门',
  north: '北侧墙与入口凹位',
  south: '南侧窗墙',
} as const

export function sourceName(object: Object3D): string {
  // GLTFLoader sanitizes names. The original Blender identifier survives in extras.
  return object.userData.source_name ?? object.name
}

export function isEffectivelyVisible(object: Object3D): boolean {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false
  }
  return true
}

export class RoomBindings {
  readonly root: Object3D
  readonly screen: Mesh
  readonly fufu: Object3D
  readonly shelfFufu: Object3D
  readonly meshes: Mesh[] = []
  readonly bounds: Box3
  private readonly ceiling: Object3D
  private readonly walls: { object: Object3D; normal: Vector3 }[]
  private readonly originalScreenMaterial: Material | Material[]
  private readonly onMaterial: MeshStandardMaterial
  private readonly offMaterial = new MeshStandardMaterial({
    name: '网页 · 关闭的屏幕', color: new Color('#111815'), roughness: 0.27,
    metalness: 0.05,
  })
  private readonly direction = new Vector3()
  private readonly centre = new Vector3()
  private readonly artworkCleanup: (() => void)[] = []
  private readonly restoreShelf: () => void
  private readonly fufuMeshes = new Set<Object3D>()
  screenOn = true

  constructor(root: Object3D) {
    this.root = root
    const objects = new Map<string, Object3D>()
    root.updateMatrixWorld(true)
    root.traverse((object) => {
      objects.set(sourceName(object), object)
    })
    const required = (name: string) => {
      const object = objects.get(name)
      if (!object) throw new Error(`模型中缺少对象：${name}`)
      return object
    }
    const screen = required(PARTS.screen)
    if (!(screen instanceof Mesh) || !(screen.material instanceof MeshStandardMaterial)) {
      throw new Error('电脑屏幕材质不兼容')
    }
    this.screen = screen
    this.fufu = required(FUFU.bed)
    const replacement = replaceShelfFufu(this.fufu, required(FUFU.oldShelf))
    this.shelfFufu = replacement.object
    this.restoreShelf = replacement.restore
    for (const toy of [this.fufu, this.shelfFufu]) {
      toy.traverse(object => { if (object instanceof Mesh) this.fufuMeshes.add(object) })
    }
    root.traverse(object => { if (object instanceof Mesh) this.meshes.push(object) })
    this.ceiling = required(PARTS.ceiling)
    this.walls = [
      { object: required(PARTS.east), normal: new Vector3(1, 0, 0) },
      { object: required(PARTS.west), normal: new Vector3(-1, 0, 0) },
      { object: required(PARTS.north), normal: new Vector3(0, 0, -1) },
      { object: required(PARTS.south), normal: new Vector3(0, 0, 1) },
    ]
    this.bounds = new Box3().setFromObject(root)
    this.bounds.getCenter(this.centre)
    this.originalScreenMaterial = screen.material
    this.onMaterial = screen.material.clone()
    this.onMaterial.name = '网页 · 点亮的屏幕'
    this.offMaterial.side = screen.material.side
    this.screen.material = this.onMaterial
    this.addArtwork(this.screen, this.onMaterial, 'desktop')
    for (const mesh of this.meshes) {
      if (mesh.material instanceof MeshStandardMaterial && mesh.material.name === '相框 · 几何装饰') {
        const original = mesh.material
        const material = original.clone()
        mesh.material = material
        this.addArtwork(mesh, material, 'frame')
        this.artworkCleanup.push(() => { mesh.material = original; material.dispose() })
      }
    }
    this.ceiling.visible = false
  }

  private addArtwork(mesh: Mesh, material: MeshStandardMaterial, kind: 'desktop' | 'frame') {
    const originalGeometry = mesh.geometry
    const geometry = originalGeometry.clone()
    const box = new Box3().setFromObject(mesh)
    const horizontal = box.max.z - box.min.z > box.max.x - box.min.x ? 'z' : 'x'
    const positions = geometry.getAttribute('position')
    const point = new Vector3()
    const uv: number[] = []
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld)
      const u = (point[horizontal] - box.min[horizontal]) / (box.max[horizontal] - box.min[horizontal])
      uv.push(horizontal === 'z' ? 1 - u : u, (point.y - box.min.y) / (box.max.y - box.min.y))
    }
    geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
    mesh.geometry = geometry
    const texture = createArtwork(kind)
    material.map = texture
    material.color.set('#ffffff')
    if (kind === 'desktop') {
      material.emissiveMap = texture
      material.emissive.set('#ffffff')
      material.emissiveIntensity = 0.55
    }
    this.artworkCleanup.push(() => { mesh.geometry = originalGeometry; geometry.dispose(); texture.dispose() })
  }

  setScreenPower(on: boolean) {
    this.screenOn = on
    this.screen.material = on ? this.onMaterial : this.offMaterial
  }

  updateCutaway(cameraPosition: Vector3) {
    this.direction.copy(cameraPosition).sub(this.centre).setY(0).normalize()
    for (const wall of this.walls) {
      const facing = wall.normal.dot(this.direction)
      // A small dead band avoids flickering when looking along the edge of a wall.
      if (facing > 0.10) wall.object.visible = false
      else if (facing < -0.10) wall.object.visible = true
    }
    this.ceiling.visible = false
  }

  hitScreen(pointer: Vector2, camera: PerspectiveCamera, raycaster: Raycaster) {
    return this.hitTarget(pointer, camera, raycaster) === 'screen'
  }

  createFufuDisplay() { return createFufuDisplay(this.fufu) }

  hitTarget(pointer: Vector2, camera: PerspectiveCamera, raycaster: Raycaster): 'screen' | 'fufu' | null {
    camera.updateMatrixWorld()
    raycaster.setFromCamera(pointer, camera)
    // Hidden ancestors must be filtered explicitly; Raycaster ignores visibility.
    const hit = raycaster.intersectObjects(this.meshes.filter(isEffectivelyVisible), false)[0]
    if (!hit) return null
    if (this.fufuMeshes.has(hit.object)) return 'fufu'
    return hit.object === this.screen ? 'screen' : null
  }

  dispose() {
    this.restoreShelf()
    this.artworkCleanup.forEach((dispose) => dispose())
    this.screen.material = this.originalScreenMaterial
    this.onMaterial.dispose()
    this.offMaterial.dispose()
  }
}

export function getViewPose(view: RoomView, bounds: Box3, aspect: number) {
  if (view === 'desk') {
    return {
      position: new Vector3(0.75, 1.63, -0.15),
      target: new Vector3(-1.18, 1.25, 1.40),
      fov: aspect < 0.8 ? 72 : 60,
    }
  }
  const fov = 38
  const target = bounds.getCenter(new Vector3())
  const direction = new Vector3(6, 5.3, -6.7).normalize()
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), direction).normalize()
  const up = new Vector3().crossVectors(direction, right)
  const tan = Math.tan(fov * Math.PI / 360)
  let distance = 0
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const offset = new Vector3(x, y, z).sub(target)
        distance = Math.max(distance, offset.dot(direction) + Math.max(
          Math.abs(offset.dot(up)) / tan,
          Math.abs(offset.dot(right)) / (tan * Math.max(aspect, 0.1)),
        ))
      }
    }
  }
  return { position: target.clone().addScaledVector(direction, distance * 1.12), target, fov }
}

/** A returning drag or the final finger of a pinch must never count as a tap. */
export class TapGesture {
  private pointers = new Set<number>()
  private candidate: { id: number; x: number; y: number; canceled: boolean } | null = null

  down(id: number, x: number, y: number, button: number) {
    this.pointers.add(id)
    if (this.pointers.size > 1) {
      if (this.candidate) this.candidate.canceled = true
    } else if (button === 0) {
      this.candidate = { id, x, y, canceled: false }
    }
  }

  move(id: number, x: number, y: number) {
    const tap = this.candidate
    if (tap?.id === id && Math.hypot(x - tap.x, y - tap.y) > 6) tap.canceled = true
  }

  up(id: number, x: number, y: number) {
    this.move(id, x, y)
    const isTap = this.candidate?.id === id && !this.candidate.canceled && this.pointers.size === 1
    this.pointers.delete(id)
    if (this.candidate?.id === id) this.candidate = null
    return isTap
  }

  cancel() {
    this.pointers.clear()
    this.candidate = null
  }
}
