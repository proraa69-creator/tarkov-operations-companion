// Packs a helmet GLB exported from Tripo (or similar) for the Gear theme picker: every texture is
// downscaled to 1024² and re-encoded as WebP (EXT_texture_webp), geometry is copied unchanged.
//   node scripts/gear/pack-helmet.mjs <input.glb> src/assets/gear/helmet-<name>.glb
// Then add the file to src/theme/gear/helmets.ts.
import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'

const [input, output] = process.argv.slice(2)
if (!input || !output) { console.error('usage: node scripts/gear/pack-helmet.mjs <input.glb> <output.glb>'); process.exit(1) }
const SIZE = 1024

const glb = await readFile(input)
const jsonLength = glb.readUInt32LE(12)
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'))
const bin = glb.subarray(20 + jsonLength + 8)
const slice = (bv) => bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)

const imageViews = new Map()
for (const image of gltf.images ?? []) {
  const quality = /normal/i.test(image.name ?? '') ? 90 : 86
  const data = await sharp(slice(gltf.bufferViews[image.bufferView])).resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true }).webp({ quality, effort: 6 }).toBuffer()
  imageViews.set(image.bufferView, data)
  image.mimeType = 'image/webp'
}
for (const texture of gltf.textures ?? []) {
  if (texture.source === undefined) continue
  texture.extensions = { ...texture.extensions, EXT_texture_webp: { source: texture.source } }
  delete texture.source
}
gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed ?? []).filter((name) => name !== 'FB_ngon_encoding'), 'EXT_texture_webp'])]
gltf.extensionsRequired = [...new Set([...(gltf.extensionsRequired ?? []), 'EXT_texture_webp'])]

const align = (n) => (n + 3) & ~3
const chunks = []
let offset = 0
gltf.bufferViews = gltf.bufferViews.map((bv, index) => {
  const data = imageViews.get(index) ?? slice(bv)
  chunks.push(data, Buffer.alloc(align(data.length) - data.length))
  const next = { ...bv, byteOffset: offset, byteLength: data.length }
  offset += align(data.length)
  return next
})
gltf.buffers = [{ byteLength: offset }]
let json = Buffer.from(JSON.stringify(gltf), 'utf8')
json = Buffer.concat([json, Buffer.alloc(align(json.length) - json.length, 0x20)])
const binChunk = Buffer.concat(chunks)
const header = Buffer.alloc(12)
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + binChunk.length, 8)
const chunkHeader = (length, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(length, 0); h.writeUInt32LE(type, 4); return h }
await writeFile(output, Buffer.concat([header, chunkHeader(json.length, 0x4e4f534a), json, chunkHeader(binChunk.length, 0x004e4942), binChunk]))
console.log(`${output}: ${(glb.length / 1048576).toFixed(2)} MB -> ${((28 + json.length + binChunk.length) / 1048576).toFixed(2)} MB`)
