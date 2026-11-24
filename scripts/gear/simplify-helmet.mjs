// Simplifies a packed helmet GLB with too many vertices (one mesh, one primitive, float POSITION / NORMAL / TEXCOORD_0,
// uint32 indices — what Tripo exports): meshoptimizer keeps the silhouette and the UV seams, the textures stay as they are.
//   node scripts/gear/simplify-helmet.mjs <in.glb> <out.glb> [targetVertices=30000]
// The other masks have 26–29 thousand vertices; a 150-thousand one weighs several times more for no visible gain.
import { readFile, writeFile } from 'node:fs/promises'
import { MeshoptSimplifier } from 'meshoptimizer'

const [input, output, targetArg] = process.argv.slice(2)
if (!input || !output) { console.error('usage: node scripts/gear/simplify-helmet.mjs <in.glb> <out.glb> [targetVertices]'); process.exit(1) }
const targetVertices = Number(targetArg ?? 30000)

const glb = await readFile(input)
const jsonLength = glb.readUInt32LE(12)
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'))
const bin = glb.subarray(20 + jsonLength + 8)
const view = (index) => { const bv = gltf.bufferViews[index]; return bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength) }
const floats = (accessor) => { const raw = view(accessor.bufferView); const copy = new Uint8Array(raw); return new Float32Array(copy.buffer, accessor.byteOffset ?? 0, accessor.count * { VEC2: 2, VEC3: 3 }[accessor.type]) }

if (gltf.meshes.length !== 1 || gltf.meshes[0].primitives.length !== 1) throw new Error('one mesh with one primitive expected')
const primitive = gltf.meshes[0].primitives[0]
const indexAccessor = gltf.accessors[primitive.indices]
if (indexAccessor.componentType !== 5125) throw new Error('uint32 indices expected')
const indices = new Uint32Array(new Uint8Array(view(indexAccessor.bufferView)).buffer, indexAccessor.byteOffset ?? 0, indexAccessor.count)
const attributes = Object.fromEntries(Object.entries(primitive.attributes).map(([name, index]) => [name, { accessor: gltf.accessors[index], data: floats(gltf.accessors[index]) }]))
const position = attributes.POSITION
const vertexCount = position.accessor.count

await MeshoptSimplifier.ready
// Triangles to keep, roughly in proportion to the vertices wanted; UV seams and borders stay where they are (LockBorder).
const ratio = Math.min(1, targetVertices / vertexCount)
const targetIndices = Math.floor(indices.length * ratio / 3) * 3
const [simplified, error] = MeshoptSimplifier.simplify(indices, position.data, 3, targetIndices, 0.01, ['LockBorder'])

// Only the vertices still used, in the order they are first met.
const remap = new Int32Array(vertexCount).fill(-1)
let next = 0
for (const index of simplified) if (remap[index] < 0) remap[index] = next++
const newIndices = new Uint32Array(simplified.length)
for (let i = 0; i < simplified.length; i++) newIndices[i] = remap[simplified[i]]

const chunks = []
let offset = 0
const bufferViews = []
const push = (bytes, target) => {
  const pad = (4 - (bytes.length % 4)) % 4
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) })
  chunks.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), Buffer.alloc(pad))
  offset += bytes.length + pad
  return bufferViews.length - 1
}
// Images first (their views as they are), then the new geometry.
const imageViews = new Map()
for (const image of gltf.images ?? []) {
  if (!imageViews.has(image.bufferView)) imageViews.set(image.bufferView, push(new Uint8Array(view(image.bufferView))))
  image.bufferView = imageViews.get(image.bufferView)
}
for (const [name, { accessor, data }] of Object.entries(attributes)) {
  const size = { VEC2: 2, VEC3: 3 }[accessor.type]
  const out = new Float32Array(next * size)
  for (let old = 0; old < vertexCount; old++) {
    const at = remap[old]
    if (at >= 0) for (let c = 0; c < size; c++) out[at * size + c] = data[old * size + c]
  }
  accessor.bufferView = push(new Uint8Array(out.buffer), 34962)
  accessor.byteOffset = 0
  accessor.count = next
  if (name === 'POSITION') {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (let v = 0; v < next; v++) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], out[v * 3 + c]); max[c] = Math.max(max[c], out[v * 3 + c]) }
    accessor.min = min
    accessor.max = max
  }
}
indexAccessor.bufferView = push(new Uint8Array(newIndices.buffer), 34963)
indexAccessor.byteOffset = 0
indexAccessor.count = newIndices.length
gltf.bufferViews = bufferViews
gltf.buffers = [{ byteLength: offset }]

const json = Buffer.from(JSON.stringify(gltf), 'utf8')
const jsonPad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)
const binBody = Buffer.concat(chunks)
const header = Buffer.alloc(12)
header.write('glTF', 0); header.writeUInt32LE(2, 4)
const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(json.length + jsonPad.length, 0); jsonHeader.write('JSON', 4)
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binBody.length, 0); binHeader.write('BIN\0', 4)
const out = Buffer.concat([header, jsonHeader, json, jsonPad, binHeader, binBody])
out.writeUInt32LE(out.length, 8)
await writeFile(output, out)
console.log(`${vertexCount} → ${next} vertices, ${indices.length / 3} → ${newIndices.length / 3} triangles (error ${error.toFixed(4)}), ${(glb.length / 1048576).toFixed(2)} MB → ${(out.length / 1048576).toFixed(2)} MB`)
