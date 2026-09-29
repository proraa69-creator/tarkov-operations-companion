// Adds a per-vertex sway attribute (_SWAY: x = how much the vertex swings 0..1, y = 1 on the forehead
// strings) to the Knight mask, so the dreadlocks and the strings across the forehead can swing in
// src/theme/gear/helmet3d.ts. The mask is one fused mesh and hair and balaclava share a colour, so hair
// is found by shape: thin tubes (short distance through the mesh along the inward normal), the face
// excluded. Dreads hang from the crown, so the swing weight grows with the drop below it; the forehead
// strings are the dark thread lines on the bone of the forehead (from the colour texture).
//   node scripts/gear/rig-knight.mjs            (rewrites src/assets/gear/helmet-knight.glb in place)
//   node scripts/gear/rig-knight.mjs --debug    (also writes work/knight-sway-debug.glb, weights as colours)
import sharp from 'sharp'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const FILE = join(root, 'src', 'assets', 'gear', 'helmet-knight.glb')
const DEBUG = process.argv.includes('--debug')

const glb = await readFile(FILE)
const jsonLength = glb.readUInt32LE(12)
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'))
const bin = glb.subarray(20 + jsonLength + 8)
const prim = gltf.meshes[0].primitives[0]
const read = (index, Type) => {
  const accessor = gltf.accessors[index]
  const bv = gltf.bufferViews[accessor.bufferView]
  if (bv.byteStride) throw new Error('interleaved buffers are not supported')
  const start = bin.byteOffset + (bv.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3 }[accessor.type]
  return new Type(bin.buffer.slice(start, start + accessor.count * comps * Type.BYTES_PER_ELEMENT))
}
const P = read(prim.attributes.POSITION, Float32Array)
const UV = read(prim.attributes.TEXCOORD_0, Float32Array)
const N = read(prim.attributes.NORMAL, Float32Array)
const I = read(prim.indices, Uint32Array)
const n = P.length / 3
const triCount = I.length / 3

// ---------- uniform grid of triangles for short ray casts ----------
const CELL = 0.02
const grid = new Map()
const cellKey = (x, y, z) => (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512)
for (let t = 0; t < triCount; t++) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) { const v = P[I[t * 3 + k] * 3 + c]; lo[c] = Math.min(lo[c], v); hi[c] = Math.max(hi[c], v) }
  for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x++)
    for (let y = Math.floor(lo[1] / CELL); y <= Math.floor(hi[1] / CELL); y++)
      for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z++) {
        const key = cellKey(x, y, z)
        let list = grid.get(key); if (!list) grid.set(key, (list = [])); list.push(t)
      }
}
function hitDistance(o, d, maxDist, skip) {
  let best = maxDist
  const seen = new Set()
  for (let s = 0; s <= maxDist; s += CELL * 0.5) {
    const list = grid.get(cellKey(Math.floor((o[0] + d[0] * s) / CELL), Math.floor((o[1] + d[1] * s) / CELL), Math.floor((o[2] + d[2] * s) / CELL)))
    if (!list) continue
    for (const t of list) {
      if (seen.has(t)) continue
      seen.add(t)
      const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2]
      if (a === skip || b === skip || c === skip) continue
      // Möller–Trumbore
      const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]]
      const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]]
      const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]]
      const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]
      if (Math.abs(det) < 1e-12) continue
      const inv = 1 / det
      const tv = [o[0] - P[a * 3], o[1] - P[a * 3 + 1], o[2] - P[a * 3 + 2]]
      const u = (tv[0] * p[0] + tv[1] * p[1] + tv[2] * p[2]) * inv
      if (u < 0 || u > 1) continue
      const q = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]]
      const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv
      if (v < 0 || u + v > 1) continue
      const dist = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv
      if (dist > 1e-4 && dist < best) best = dist
    }
    if (best < s) break
  }
  return best
}

// ---------- thickness → hair mask ----------
const MAX = 0.09
const thickness = new Float32Array(n)
for (let i = 0; i < n; i++) {
  const o = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]
  const d = [-N[i * 3], -N[i * 3 + 1], -N[i * 3 + 2]]
  thickness[i] = hitDistance(o, d, MAX, i)
}
// neighbours
const adj = Array.from({ length: n }, () => new Set())
for (let t = 0; t < triCount; t++) for (let k = 0; k < 3; k++) { const a = I[t * 3 + k], b = I[t * 3 + (k + 1) % 3]; adj[a].add(b); adj[b].add(a) }
// UV seams split vertices that share a position: join them so the dreads read as continuous
{
  const byPos = new Map()
  for (let i = 0; i < n; i++) {
    const key = `${P[i * 3].toFixed(4)},${P[i * 3 + 1].toFixed(4)},${P[i * 3 + 2].toFixed(4)}`
    const twin = byPos.get(key)
    if (twin === undefined) { byPos.set(key, i); continue }
    for (const j of adj[twin]) { adj[i].add(j); adj[j].add(i) }
    for (const j of adj[i]) { if (j !== twin) { adj[twin].add(j); adj[j].add(twin) } }
    adj[i].add(twin); adj[twin].add(i)
  }
}
// median-smooth the thickness over the 1-ring so single noisy rays do not flip the class
const thick = thickness.map((v, i) => { const vals = [v, ...[...adj[i]].map((j) => thickness[j])].sort((a, b) => a - b); return vals[vals.length >> 1] })
const HAIR = 0.055
// the face (skull, teeth, eye and nose holes) never counts as hair, whatever its thickness
const inFace = (i) => P[i * 3 + 2] > 0.12 && Math.abs(P[i * 3]) < 0.24 && P[i * 3 + 1] < 0.9
let hair = new Uint8Array(n)
for (let i = 0; i < n; i++) if (thick[i] < HAIR && P[i * 3 + 1] > 0.2 && !inFace(i)) hair[i] = 1
// close small gaps along the dreads (a vertex whose ring is mostly hair is hair), then drop specks
// (lower down, where only the dread ends are, any touch of hair counts: that fills the rounded tips)
for (const [want, share] of [[1, 0.5], [1, 0.5], [1, 0.2], [1, 0.2], [0, 0.34]]) {
  const next = hair.slice()
  for (let i = 0; i < n; i++) {
    if (hair[i] === want || inFace(i) || P[i * 3 + 1] < 0.2) continue
    if (share < 0.5 && P[i * 3 + 1] > 0.6) continue
    let h = 0; for (const j of adj[i]) h += hair[j]
    const ratio = h / Math.max(1, adj[i].size)
    if (want === 1 ? ratio >= share : ratio < share) next[i] = want
  }
  hair = next
}

// dread pieces are long and vertical; thin rims on the collar are short and flat: drop those
{
  const seen = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (!hair[i] || seen[i]) continue
    const piece = [i]; seen[i] = 1
    let top = -Infinity, bottom = Infinity
    for (let k = 0; k < piece.length; k++) {
      const v = piece[k]; top = Math.max(top, P[v * 3 + 1]); bottom = Math.min(bottom, P[v * 3 + 1])
      for (const j of adj[v]) if (hair[j] && !seen[j]) { seen[j] = 1; piece.push(j) }
    }
    if (top < 0.72 && top - bottom < 0.12) for (const v of piece) hair[v] = 0
  }
}

// the rounded dread ends (their caps read as thick, and some hang below the cut): grow a few rings down
for (let pass = 0; pass < 6; pass++) {
  const add = []
  for (let i = 0; i < n; i++) {
    if (hair[i] || inFace(i) || P[i * 3 + 1] >= 0.5 || P[i * 3 + 1] < 0.1) continue
    for (const j of adj[i]) if (hair[j]) { add.push(i); break }
  }
  if (!add.length) break
  for (const i of add) hair[i] = 1
}

// forehead strings: dark thread lines painted/modelled on the bone of the forehead
const tex = gltf.images[gltf.textures[gltf.materials[0].pbrMetallicRoughness.baseColorTexture.index].extensions.EXT_texture_webp.source]
const tbv = gltf.bufferViews[tex.bufferView]
const { data: pixels, info } = await sharp(bin.subarray(tbv.byteOffset ?? 0, (tbv.byteOffset ?? 0) + tbv.byteLength)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
const lum = (i) => {
  const x = Math.min(info.width - 1, Math.max(0, Math.floor(UV[i * 2] * info.width)))
  const y = Math.min(info.height - 1, Math.max(0, Math.floor(UV[i * 2 + 1] * info.height)))
  const o = (y * info.width + x) * 3
  return (pixels[o] + pixels[o + 1] + pixels[o + 2]) / 765
}
const forehead = (i) => P[i * 3 + 2] > 0.14 && P[i * 3 + 1] > 0.72 && P[i * 3 + 1] < 0.92 && Math.abs(P[i * 3]) < 0.27
const string = new Uint8Array(n)
for (let i = 0; i < n; i++) if (forehead(i) && !hair[i] && lum(i) < 0.42) string[i] = 1

// ---------- weights ----------
// dreads hang from the crown: the lower a hair vertex, the further it swings (roots near the top stay put)
const sway = new Float32Array(n * 2)
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t) }
for (let i = 0; i < n; i++) {
  if (hair[i]) sway[i * 2] = smooth((0.86 - P[i * 3 + 1]) / 0.42)
  else if (string[i]) { sway[i * 2] = 0.7; sway[i * 2 + 1] = 1 }
}
// relax so the joins with the head stretch smoothly instead of tearing
for (let pass = 0; pass < 4; pass++) {
  const next = sway.slice()
  for (let i = 0; i < n; i++) {
    let s = sway[i * 2], c = 1
    for (const j of adj[i]) { s += sway[j * 2]; c++ }
    next[i * 2] = hair[i] || string[i] ? s / c : Math.min(sway[i * 2], s / c * 0.5)
  }
  sway.set(next)
}

// ---------- write: _SWAY as a new accessor (VEC2 float) ----------
const align = (x) => (x + 3) & ~3
const swayBytes = Buffer.from(sway.buffer)
const out = structuredClone(gltf)
const existing = out.meshes[0].primitives[0].attributes._SWAY
let binOut = Buffer.from(bin.subarray(0, gltf.buffers[0].byteLength))
if (existing !== undefined) {
  // re-run: overwrite the old attribute data in place
  const bv = out.bufferViews[out.accessors[existing].bufferView]
  swayBytes.copy(binOut, bv.byteOffset ?? 0)
} else {
  const offset = align(binOut.length)
  binOut = Buffer.concat([binOut, Buffer.alloc(offset - binOut.length), swayBytes])
  out.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: swayBytes.length, target: 34962 })
  out.accessors.push({ bufferView: out.bufferViews.length - 1, componentType: 5126, count: n, type: 'VEC2' })
  out.meshes[0].primitives[0].attributes._SWAY = out.accessors.length - 1
}
binOut = Buffer.concat([binOut, Buffer.alloc(align(binOut.length) - binOut.length)])
out.buffers = [{ byteLength: binOut.length }]
async function writeGlb(path, doc, data) {
  let json = Buffer.from(JSON.stringify(doc), 'utf8')
  json = Buffer.concat([json, Buffer.alloc(align(json.length) - json.length, 0x20)])
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + data.length, 8)
  const chunk = (length, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(length, 0); h.writeUInt32LE(type, 4); return h }
  await writeFile(path, Buffer.concat([header, chunk(json.length, 0x4e4f534a), json, chunk(data.length, 0x004e4942), data]))
}
await writeGlb(FILE, out, binOut)
const hairCount = hair.reduce((a, b) => a + b, 0)
let strings = 0; for (let i = 0; i < n; i++) if (string[i]) strings++
console.log(`helmet-knight.glb: ${hairCount} hair vertices of ${n}, ${strings} on the forehead strings`)

if (DEBUG) {
  // colours: red = swing weight, blue = forehead strings; texture removed so the colours show
  const colors = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) { colors[i * 4] = sway[i * 2]; colors[i * 4 + 1] = hair[i] ? 0.25 : 0.6; colors[i * 4 + 2] = sway[i * 2 + 1] ? 1 : (hair[i] ? 0.1 : 0.6); colors[i * 4 + 3] = 1 }
  const dbg = structuredClone(out)
  const bytes = Buffer.from(colors.buffer)
  const offset = binOut.length
  const dbgBin = Buffer.concat([binOut, bytes])
  dbg.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: 34962 })
  dbg.accessors.push({ bufferView: dbg.bufferViews.length - 1, componentType: 5126, count: n, type: 'VEC4' })
  dbg.meshes[0].primitives[0].attributes.COLOR_0 = dbg.accessors.length - 1
  delete dbg.materials[0].pbrMetallicRoughness.baseColorTexture
  dbg.buffers = [{ byteLength: dbgBin.length }]
  await mkdir(join(root, 'work'), { recursive: true })
  await writeGlb(join(root, 'work', 'knight-sway-debug.glb'), dbg, dbgBin)
}
