// Repack this room's GLB from allowed buffer views. Removed photo bytes are never
// copied into the output BIN chunk, including unused/orphaned image data.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const [input, output, manifestPath] = process.argv.slice(2)
if (!input || !output || resolve(input) === resolve(output)) throw new Error('Usage: node scripts/sanitize-model.mjs INPUT.glb OUTPUT.glb [MANIFEST.json]; use separate paths')
const source = await readFile(input)
assert.equal(source.readUInt32LE(0), 0x46546c67)
assert.equal(source.readUInt32LE(4), 2)
assert.equal(source.readUInt32LE(16), 0x4e4f534a)
const jsonEnd = 20 + source.readUInt32LE(12)
assert.equal(source.readUInt32LE(jsonEnd + 4), 0x004e4942)
const bin = source.subarray(jsonEnd + 8)
const doc = JSON.parse(source.subarray(20, jsonEnd).toString())
assert.equal(doc.buffers.length, 1)
assert.deepEqual(doc.extensionsUsed, ['KHR_materials_emissive_strength'])
const geometryBefore = JSON.stringify([doc.nodes, doc.meshes, doc.scenes])
const photos = new Set(doc.images.flatMap((image, i) => image.mimeType === 'image/jpeg' || /^IMG_/i.test(image.name ?? '') ? [i] : []))
assert.equal(photos.size, 1, 'Expected exactly one embedded source photo in the private input')
const removedViews = new Set([...photos].map((i) => doc.images[i].bufferView))
const photoBytes = [...removedViews].map((i) => {
  const view = doc.bufferViews[i]
  return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
})
const removedTextures = new Set(doc.textures.flatMap((texture, i) => photos.has(texture.source) ? [i] : []))
let changed = 0
for (const material of doc.materials) {
  const screen = material.name.startsWith('显示器 · 参考照片屏幕')
  const frame = material.name.startsWith('相框 · 原照片内容')
  if (!screen && !frame) continue
  changed++
  material.name = screen ? '屏幕 · 程序桌面' : '相框 · 几何装饰'
  material.pbrMetallicRoughness = { baseColorFactor: screen ? [0.05, 0.12, 0.11, 1] : [0.7, 0.77, 0.65, 1], metallicFactor: 0, roughnessFactor: 0.5 }
  delete material.emissiveTexture
  material.emissiveFactor = screen ? [0.05, 0.12, 0.11] : [0, 0, 0]
}
assert.equal(changed, 2)
const filterIndices = (array, removed) => {
  const map = new Map()
  const kept = array.filter((_, i) => !removed.has(i))
  let next = 0
  array.forEach((_, i) => { if (!removed.has(i)) map.set(i, next++) })
  return { kept, map }
}
const imageIndices = filterIndices(doc.images, photos)
const textureIndices = filterIndices(doc.textures, removedTextures)
const viewIndices = filterIndices(doc.bufferViews, removedViews)
doc.images = imageIndices.kept
doc.textures = textureIndices.kept
for (const texture of doc.textures) {
  assert.ok(imageIndices.map.has(texture.source))
  texture.source = imageIndices.map.get(texture.source)
}
const remapReferences = (object) => {
  if (!object || typeof object !== 'object') return
  for (const [key, value] of Object.entries(object)) {
    if (key === 'bufferView') {
      assert.ok(viewIndices.map.has(value), 'Photo buffer is unexpectedly shared with geometry')
      object[key] = viewIndices.map.get(value)
    } else if (/Texture$/.test(key) && value && typeof value === 'object' && 'index' in value) {
      assert.ok(textureIndices.map.has(value.index), 'Unremoved material photo reference')
      value.index = textureIndices.map.get(value.index)
    } else remapReferences(value)
  }
}
remapReferences(doc)
const chunks = []
let offset = 0
doc.bufferViews = viewIndices.kept.map((view) => {
  assert.equal(view.buffer, 0)
  const payload = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
  const result = { ...view, byteOffset: offset }
  chunks.push(payload)
  offset += payload.length
  const padding = (4 - offset % 4) % 4
  if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding }
  return result
})
doc.buffers = [{ byteLength: offset }]
assert.equal(JSON.stringify([doc.nodes, doc.meshes, doc.scenes]), geometryBefore)
assert.ok(!JSON.stringify(doc).includes('IMG_'))
const binary = Buffer.concat(chunks)
for (const photo of photoBytes) {
  assert.ok(!binary.includes(photo))
  for (const start of [0, Math.floor(photo.length / 2), photo.length - 256]) assert.ok(!binary.includes(photo.subarray(start, start + 256)))
}
const rawJson = Buffer.from(JSON.stringify(doc))
const json = Buffer.concat([rawJson, Buffer.alloc((4 - rawJson.length % 4) % 4, 0x20)])
const header = Buffer.alloc(20)
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4)
header.writeUInt32LE(28 + json.length + binary.length, 8)
header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
const binHeader = Buffer.alloc(8)
binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4)
const cleaned = Buffer.concat([header, json, binHeader, binary])
await mkdir(dirname(output), { recursive: true })
await writeFile(output, cleaned)
const textures = doc.images.map((image) => {
  assert.equal(image.mimeType, 'image/png')
  const view = doc.bufferViews[image.bufferView]
  const bytes = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength)
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  return { name: image.name, sha256: createHash('sha256').update(bytes).digest('hex') }
})
if (manifestPath) await writeFile(manifestPath, JSON.stringify({ description: 'Reviewed procedural material textures. No source photographs.', textures }, null, 2) + '\n')
console.log(JSON.stringify({ removedPhotos: photos.size, removedTextureSlots: removedTextures.size, retainedProceduralImages: textures.length, originalBytes: source.length, sanitizedBytes: cleaned.length, sha256: createHash('sha256').update(cleaned).digest('hex') }))
