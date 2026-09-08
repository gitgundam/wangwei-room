import { Box3, Object3D, Quaternion, Vector3 } from 'three'

export const FUFU = {
  bed: '初音未来 fufu · 整体',
  oldShelf: '墙架初音玩偶 · 整体',
  shelf: '架上精修 fufu · 整体',
} as const

/** Copies transforms, sharing the already loaded geometry and fabric textures. */
export function createFufuDisplay(source: Object3D) {
  const copy = source.clone(true)
  copy.position.set(0, 0, 0)
  copy.quaternion.identity()
  copy.updateMatrixWorld(true)
  const centre = new Box3().setFromObject(copy).getCenter(new Vector3())
  copy.position.sub(centre)
  const display = new Object3D()
  display.name = 'fufu · 独立展示'
  display.add(copy)
  display.updateMatrixWorld(true)
  return display
}

/** Fits the refined toy into the old toy's shelf footprint, preserving its facing. */
export function replaceShelfFufu(source: Object3D, previous: Object3D) {
  const parent = previous.parent
  if (!parent) throw new Error('架上玩偶缺少父分组')
  previous.updateWorldMatrix(true, true)
  const slot = new Box3().setFromObject(previous)
  const display = createFufuDisplay(source)
  const size = new Box3().setFromObject(display).getSize(new Vector3())
  const slotSize = slot.getSize(new Vector3())
  display.scale.setScalar(Math.min(1, Math.max(slotSize.x, slotSize.z) / size.x))
  display.quaternion.copy(previous.getWorldQuaternion(new Quaternion()))
  display.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(display)
  display.position.copy(slot.getCenter(new Vector3())).setY(slot.min.y - bounds.min.y)
  display.traverse(object => {
    object.name = `架上 · ${object.userData.source_name ?? object.name}`
    object.userData.source_name = object.name
  })
  display.name = FUFU.shelf
  display.userData.source_name = FUFU.shelf
  parent.attach(display)
  previous.removeFromParent()
  parent.updateMatrixWorld(true)
  return {
    object: display,
    restore: () => { display.removeFromParent(); parent.add(previous) },
  }
}

export function getFufuDistance(size: Vector3, aspect: number, fov = 32) {
  const tangent = Math.tan(fov * Math.PI / 360)
  return Math.max(size.y / (2 * tangent), size.x / (2 * tangent * Math.max(aspect, 0.1))) * 1.25 + size.z / 2
}
