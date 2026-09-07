// Append the reviewed fufu mesh without re-exporting or changing existing room geometry.
// Usage: node scripts/add-fufu.mjs ROOM.glb FUFU.glb OUTPUT.glb MANIFEST.json
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const [roomPath, toyPath, outputPath, manifestPath] = process.argv.slice(2)
assert.ok(roomPath && toyPath && outputPath && manifestPath, 'ROOM FUFU OUTPUT MANIFEST are required')
assert.notEqual(resolve(roomPath), resolve(outputPath), 'Preserve the original room as a separate input')
async function readGLB(path) {
  const bytes = await readFile(path)
  assert.equal(bytes.readUInt32LE(0), 0x46546c67)
  assert.equal(bytes.readUInt32LE(4), 2)
  assert.equal(bytes.readUInt32LE(8), bytes.length)
  const end = 20 + bytes.readUInt32LE(12)
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a)
  assert.equal(bytes.readUInt32LE(end + 4), 0x004e4942)
  const json = JSON.parse(bytes.subarray(20, end).toString())
  assert.equal(json.buffers.length, 1)
  assert.equal(json.buffers[0].uri, undefined)
  return { json, bin: bytes.subarray(end + 8) }
}
const [room, toy] = await Promise.all([readGLB(roomPath), readGLB(toyPath)])
const r = room.json, t = toy.json
for (const key of ['animations', 'skins', 'cameras']) assert.ok(!t[key]?.length, `Unexpected fufu ${key}`)
assert.ok(!r.nodes.some(n => n.name === '初音未来 fufu · 整体'), 'Room already contains this fufu')
const parent = r.nodes.findIndex(n => n.name === '床 · 含床品与玩偶')
assert.ok(parent >= 0)
const originalNodes = JSON.stringify(r.nodes), originalMeshes = JSON.stringify(r.meshes)
const keys = ['bufferViews', 'accessors', 'images', 'samplers', 'textures', 'materials', 'meshes', 'nodes']
const offsets = Object.fromEntries(keys.map(k => [k, r[k]?.length ?? 0]))
for (const view of t.bufferViews) { assert.equal(view.buffer, 0); view.byteOffset = (view.byteOffset ?? 0) + room.bin.length }
for (const a of t.accessors) {
  if (a.bufferView !== undefined) a.bufferView += offsets.bufferViews
  assert.equal(a.sparse, undefined, 'Sparse accessors are not expected in this export')
}
for (const im of t.images ?? []) {
  assert.equal(im.uri, undefined); assert.equal(im.mimeType, 'image/png')
  assert.ok(/^fufu_(plush|woven|embroidery)_normal$/.test(im.name), 'Only generated fufu fabric maps are allowed')
  im.bufferView += offsets.bufferViews
}
for (const tex of t.textures ?? []) {
  if (tex.source !== undefined) tex.source += offsets.images
  if (tex.sampler !== undefined) tex.sampler += offsets.samplers
  assert.equal(tex.extensions, undefined)
}
function remapMaterialTextures(obj) {
  if (!obj || typeof obj !== 'object') return
  for (const [key, value] of Object.entries(obj)) {
    if (/Texture$/.test(key) && value && typeof value === 'object' && 'index' in value) value.index += offsets.textures
    else remapMaterialTextures(value)
  }
}
for (const mat of t.materials ?? []) remapMaterialTextures(mat)
for (const mesh of t.meshes) for (const p of mesh.primitives) {
  for (const key in p.attributes) p.attributes[key] += offsets.accessors
  if (p.indices !== undefined) p.indices += offsets.accessors
  if (p.material !== undefined) p.material += offsets.materials
  assert.equal(p.targets, undefined); assert.equal(p.extensions, undefined)
}
for (const n of t.nodes) {
  if (n.mesh !== undefined) n.mesh += offsets.meshes
  if (n.children) n.children = n.children.map(i => i + offsets.nodes)
}
const toyRootIndices = t.scenes[t.scene ?? 0].nodes
assert.equal(toyRootIndices.length, 1)
const root = t.nodes[toyRootIndices[0]]
assert.equal(root.name, '初音未来 fufu · 整体')
assert.equal(root.matrix, undefined)
// World position on the clear mattress beside the head cushions. glTF uses Y-up.
const world = [0.82, 0.453, -0.60]
const base = root.translation ?? [0, 0, 0]
root.translation = world.map((v, i) => v + base[i] - (r.nodes[parent].translation?.[i] ?? 0))
const angle = 135 * Math.PI / 180
root.rotation = [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)]
root.extras = { ...root.extras, placement: '床面靠枕处 · 新增玩偶' }
for (const k of keys) if (t[k]) r[k] = [...(r[k] ?? []), ...t[k]]
r.nodes[parent].children.push(toyRootIndices[0] + offsets.nodes)
r.extensionsUsed = [...new Set([...(r.extensionsUsed ?? []), ...(t.extensionsUsed ?? [])])]
if (t.extensionsRequired?.length) r.extensionsRequired = [...new Set([...(r.extensionsRequired ?? []), ...t.extensionsRequired])]
const binary = Buffer.concat([room.bin, toy.bin]); r.buffers = [{ byteLength: binary.length }]
// Verify original geometry and every original node property except the new child reference.
assert.equal(JSON.stringify(r.meshes.slice(0, offsets.meshes)), originalMeshes)
const originalPart = structuredClone(r.nodes.slice(0, offsets.nodes));originalPart[parent].children.pop()
assert.equal(JSON.stringify(originalPart), originalNodes)
const jsonBytes = Buffer.from(JSON.stringify(r))
const json = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 0x20)])
const header = Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2, 4);header.writeUInt32LE(28 + json.length + binary.length, 8);header.writeUInt32LE(json.length, 12);header.writeUInt32LE(0x4e4f534a, 16)
const binHeader = Buffer.alloc(8);binHeader.writeUInt32LE(binary.length);binHeader.writeUInt32LE(0x004e4942, 4)
const result = Buffer.concat([header, json, binHeader, binary])
const textures = r.images.map(im => {
  const v = r.bufferViews[im.bufferView]
  return { name: im.name, sha256: createHash('sha256').update(binary.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)).digest('hex') }
})
await writeFile(outputPath, result)
await writeFile(manifestPath, JSON.stringify({ description: 'Reviewed procedural room textures and generated fufu fabric normal maps. No source photographs.', textures }, null, 2) + '\n')
console.log(JSON.stringify({ addedMeshes: t.meshes.length, addedTextures: t.images.length, bytes: result.length, sha256: createHash('sha256').update(result).digest('hex') }))
