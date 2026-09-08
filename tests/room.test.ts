import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { Box3, Mesh, MeshStandardMaterial, PerspectiveCamera, Quaternion, Raycaster, Texture, Vector2, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { getViewPose, PARTS, RoomBindings, sourceName, TapGesture } from '../src/scene/room-state.ts'
import { createFufuDisplay, FUFU, getFufuDistance } from '../src/scene/fufu.ts'

const file = await readFile(new URL('../public/models/room.glb', import.meta.url))
const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
const loader = new GLTFLoader()
// Decode the actual GLB hierarchy, geometry and materials in Node. Only browser
// image decoding is substituted; visual/WebGL rendering is not claimed by these tests.
loader.register((parser) => ({
  name: 'NODE_TEST_TEXTURES',
  loadTexture: async (index: number) => {
    const texture = new Texture()
    texture.name = parser.json.images[parser.json.textures[index].source].name
    texture.flipY = false
    return texture
  },
}))
const { scene } = await loader.parseAsync(bytes, '')
const bindings = new RoomBindings(scene)
const json = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString())
const objects = new Map<string, typeof scene.children[number]>()
scene.traverse((object) => objects.set(sourceName(object), object))

function cameraFor(view: 'overview' | 'desk', aspect: number) {
  const pose = getViewPose(view, bindings.bounds, aspect)
  const camera = new PerspectiveCamera(pose.fov, aspect, 0.035, 100)
  camera.position.copy(pose.position)
  camera.lookAt(pose.target)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera
}

test('published GLB contains only reviewed procedural textures and no orphaned binary data', async () => {
  const manifest = JSON.parse(await readFile(new URL('./fixtures/room-textures.json', import.meta.url), 'utf8'))
  assert.equal(json.images.length, 31)
  const allowed = new Map(manifest.textures.map((image: {name: string; sha256: string}) => [image.name, image.sha256]))
  const binStart = 20 + file.readUInt32LE(12) + 8
  for (const image of json.images) {
    assert.equal(image.uri, undefined)
    assert.equal(image.mimeType, 'image/png')
    const view = json.bufferViews[image.bufferView]
    const bytes = file.subarray(binStart + (view.byteOffset ?? 0), binStart + (view.byteOffset ?? 0) + view.byteLength)
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(createHash('sha256').update(bytes).digest('hex'), allowed.get(image.name))
  }
  const metadata = JSON.stringify(json)
  assert.ok(!/IMG_\d|image\/jpeg|data:image|\.heic/i.test(metadata))
  // Every byte must belong to a declared view, except zero-filled 4-byte alignment.
  let cursor = binStart
  for (const view of json.bufferViews) {
    const start = binStart + (view.byteOffset ?? 0)
    assert.ok(start >= cursor && start - cursor <= 3)
    assert.ok(file.subarray(cursor, start).every(byte => byte === 0))
    cursor = start + view.byteLength
  }
  assert.ok(file.length - cursor <= 3)
  assert.ok(file.subarray(cursor).every(byte => byte === 0))
})

test('actual model preserves metric bounds, meshes and all required semantic groups', () => {
  assert.equal(json.meshes.length, 784 + 63)
  // Shelf copy shares the refined toy's geometry; the old shelf assembly is replaced.
  const oldShelf = json.nodes.findIndex((node: {extras?: {source_name?: string}}) => node.extras?.source_name === FUFU.oldShelf)
  const countPrimitives = (index: number): number => {
    const node = json.nodes[index]
    return (node.mesh === undefined ? 0 : json.meshes[node.mesh].primitives.length) + (node.children ?? []).reduce((sum: number, child: number) => sum + countPrimitives(child), 0)
  }
  assert.equal(bindings.meshes.length, json.meshes.reduce((sum: number, mesh: {primitives: unknown[]}) => sum + mesh.primitives.length, 0) - countPrimitives(oldShelf) + 63)
  const expectedMin = [-1.57, -0.13, -2.23]
  const expectedMax = [1.75, 2.73, 2.29]
  bindings.bounds.min.toArray().forEach((value, i) => assert.ok(Math.abs(value - expectedMin[i]!) < 0.015, String(value)))
  bindings.bounds.max.toArray().forEach((value, i) => assert.ok(Math.abs(value - expectedMax[i]!) < 0.015, String(value)))
  Object.values(PARTS).forEach((name) => assert.ok(objects.has(name), name))
})

test('bed fufu remains a separate 40cm assembly after replacing the shelf toy', () => {
  const toy = objects.get('初音未来 fufu · 整体')
  assert.ok(toy)
  assert.equal(sourceName(toy.parent!), '床 · 含床品与玩偶')
  assert.ok(objects.has('床头上方初音玩偶 · 整体'))
  assert.ok(objects.has(FUFU.shelf))
  assert.ok(!objects.has(FUFU.oldShelf))
  const required = ['左马尾', '右马尾', '脸部', '左刺绣眼睛', '右刺绣眼睛', '粉色笑嘴', '米白褶裙', '后领高音谱号']
  required.forEach(name => assert.ok(objects.get(`fufu · ${name}`) instanceof Mesh, name))
  const bounds = new Box3().setFromObject(toy)
  assert.ok(bounds.min.y >= 0.451 && bounds.min.y <= 0.457, 'must contact the mattress')
  assert.ok(bounds.min.x > -0.6685 && bounds.max.x < 1.4045)
  assert.ok(bounds.min.z > -1.1725 && bounds.max.z < 0.6625)
  const inverseRotation = toy.getWorldQuaternion(new Quaternion()).invert()
  const origin = toy.getWorldPosition(new Vector3())
  const aligned = new Box3()
  const point = new Vector3()
  let meshes = 0
  toy.traverse(object => {
    if (!(object instanceof Mesh)) return
    meshes++
    const positions = object.geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).sub(origin).applyQuaternion(inverseRotation)
      assert.ok(point.toArray().every(Number.isFinite))
      aligned.expandByPoint(point)
    }
  })
  assert.equal(meshes, 63)
  assert.ok(Math.abs(aligned.getSize(new Vector3()).x - 0.4) < 0.003, '40cm calibrated width')
})

test('shelf fufu fits the existing shelf, reuses assets, and is selectable with occlusion', () => {
  const toy = bindings.shelfFufu
  const bounds = new Box3().setFromObject(toy)
  assert.ok(bounds.min.y > 1.513 && bounds.min.y < 1.519)
  assert.ok(bounds.min.x > -1.45 && bounds.max.x < -1.09)
  assert.ok(bounds.min.z >= 1.318 && bounds.max.z <= 1.612)
  const bedGeometry = new Set()
  bindings.fufu.traverse(object => { if (object instanceof Mesh) bedGeometry.add(object.geometry) })
  toy.traverse(object => { if (object instanceof Mesh) assert.ok(bedGeometry.has(object.geometry)) })
  for (const aspect of [1.5, 0.48]) {
    const camera = cameraFor('desk', aspect)
    bindings.updateCutaway(camera.position)
    const centre = bounds.getCenter(new Vector3()).project(camera)
    assert.ok(Math.abs(centre.x) < 1 && Math.abs(centre.y) < 1)
    const pointer = new Vector2(centre.x, centre.y)
    assert.equal(bindings.hitTarget(pointer, camera, new Raycaster()), 'fufu')
    toy.visible = false
    assert.notEqual(bindings.hitTarget(pointer, camera, new Raycaster()), 'fufu')
    toy.visible = true
  }
})

test('independent display leaves the room unchanged and fits desktop and phone views', () => {
  const originalTransform = bindings.fufu.matrixWorld.clone()
  const model = createFufuDisplay(bindings.fufu)
  const bounds = new Box3().setFromObject(model)
  assert.ok(bounds.getCenter(new Vector3()).length() < 1e-6)
  const size = bounds.getSize(new Vector3())
  assert.ok(Math.abs(size.x - 0.4) < 0.003)
  for (const aspect of [2.5, 1.5, 0.6, 0.4]) {
    const camera = new PerspectiveCamera(32, aspect, 0.01, 10)
    camera.position.set(0, 0.025, getFufuDistance(size, aspect))
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const corner = new Vector3(x, y, z).project(camera)
      assert.ok(Math.abs(corner.x) < 0.93 && Math.abs(corner.y) < 0.93)
      assert.ok(corner.z > -1 && corner.z < 1)
    }
  }
  model.rotation.y = 1.2
  model.scale.setScalar(2)
  model.updateMatrixWorld(true)
  assert.deepEqual(bindings.fufu.matrixWorld.elements, originalTransform.elements)
})

test('screen power is reversible without changing other materials or geometric artwork', () => {
  const original = bindings.screen.material as MeshStandardMaterial
  assert.ok(original.map)
  const otherMaterials = bindings.meshes.filter((mesh) => mesh !== bindings.screen).map((mesh) => ({ mesh, material: mesh.material }))
  const others = otherMaterials.map(({ material }) => JSON.stringify((Array.isArray(material) ? material : [material]).map((m) => m.toJSON())))
  bindings.setScreenPower(false)
  const off = bindings.screen.material as MeshStandardMaterial
  assert.equal(off.map, null)
  assert.equal(off.emissive.getHex(), 0)
  assert.equal(bindings.screenOn, false)
  bindings.setScreenPower(true)
  assert.equal(bindings.screen.material, original)
  assert.ok(original.map)
  otherMaterials.forEach(({ mesh, material }, i) => {
    assert.equal(mesh.material, material)
    assert.equal(JSON.stringify((Array.isArray(material) ? material : [material]).map((m) => m.toJSON())), others[i])
  })
})

test('rotating to each quadrant hides near walls, shows far walls, and always hides the ceiling', () => {
  for (const x of [-6, 6]) {
    for (const z of [-6, 6]) {
      bindings.updateCutaway(new Vector3(x, 5, z))
      assert.equal(objects.get(PARTS.east)!.visible, x < 0)
      assert.equal(objects.get(PARTS.west)!.visible, x > 0)
      assert.equal(objects.get(PARTS.south)!.visible, z < 0)
      assert.equal(objects.get(PARTS.north)!.visible, z > 0)
      assert.equal(objects.get(PARTS.ceiling)!.visible, false)
    }
  }
})

test('overview frames every room corner on desktop, portrait phone and short landscape', () => {
  for (const aspect of [2.3, 1.5, 0.72, 0.48]) {
    const camera = cameraFor('overview', aspect)
    for (const x of [bindings.bounds.min.x, bindings.bounds.max.x]) {
      for (const y of [bindings.bounds.min.y, bindings.bounds.max.y]) {
        for (const z of [bindings.bounds.min.z, bindings.bounds.max.z]) {
          const projected = new Vector3(x, y, z).project(camera)
          assert.ok(Math.abs(projected.x) < 0.93, `horizontal clipping at aspect ${aspect}: ${projected.x}`)
          assert.ok(Math.abs(projected.y) < 0.93, `vertical clipping at aspect ${aspect}: ${projected.y}`)
          assert.ok(projected.z > -1 && projected.z < 1)
        }
      }
    }
  }
})

test('desk view can actually click the visible screen, with proper occlusion', () => {
  for (const aspect of [1.5, 0.72]) {
    const camera = cameraFor('desk', aspect)
    bindings.updateCutaway(camera.position)
    const screenCentre = new Box3().setFromObject(bindings.screen).getCenter(new Vector3())
    const ndc = screenCentre.project(camera)
    assert.ok(Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1, 'screen must be inside the viewport')
    assert.equal(bindings.hitScreen(new Vector2(ndc.x, ndc.y), camera, new Raycaster()), true)
    assert.equal(bindings.hitScreen(new Vector2(0.99, 0.99), camera, new Raycaster()), false)
    const parent = bindings.screen.parent!
    const previous = parent.visible
    parent.visible = false
    assert.equal(bindings.hitScreen(new Vector2(ndc.x, ndc.y), camera, new Raycaster()), false)
    parent.visible = previous
  }
})

test('drag, returning drag, right button and pinch never trigger a screen tap', () => {
  const tap = new TapGesture()
  tap.down(1, 20, 20, 0)
  assert.equal(tap.up(1, 21, 20), true)
  tap.down(1, 20, 20, 0)
  tap.move(1, 40, 20)
  assert.equal(tap.up(1, 20, 20), false)
  tap.down(1, 20, 20, 2)
  assert.equal(tap.up(1, 20, 20), false)
  tap.down(1, 20, 20, 0)
  tap.down(2, 30, 20, 0)
  assert.equal(tap.up(2, 30, 20), false)
  assert.equal(tap.up(1, 20, 20), false)
  tap.down(1, 20, 20, 0)
  tap.cancel()
  assert.equal(tap.up(1, 20, 20), false)
})
