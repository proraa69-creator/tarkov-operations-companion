// Adds a per-vertex sway attribute (_SWAY: x = how much the vertex swings 0..1, y = 1 on hair) to a boss
// model so everything that hangs — a cape, cloth panels on the hips, dreadlocks — swings and sags in the
// Gallery viewer (an earlier, offline version: the viewer now analyses each model as it loads, src/gallery/swayWeights.ts
// and src/gallery/physics). Tripo models are one fused mesh, so hanging parts are found
// by shape: a thin sheet or tube (short distance through the mesh along the inward normal) with free air
// on both sides (armour plates are thin too, but the body sits right behind them). The swing weight grows
// with the distance along the surface from where the cloth joins the rest of the model.
//   node scripts/bosses/rig-cloth.mjs src/assets/boss-models/dark-knight.glb [--debug]
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const FILE = resolve(process.argv[2])
const DEBUG = process.argv.includes('--debug')
const THIN = +(process.env.THIN || 0.035) // max sheet/tube thickness
const FREE = +(process.env.FREE || 0.025) // min free air in front of and behind the sheet
const REACH = +(process.env.REACH || 0.3) // surface distance over which the weight goes 0 → 1

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

// ---------- thickness and free space around each vertex ----------
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


const along = (i, sign, from, max) => {
  const o = [P[i * 3] + sign * N[i * 3] * from, P[i * 3 + 1] + sign * N[i * 3 + 1] * from, P[i * 3 + 2] + sign * N[i * 3 + 2] * from]
  return hitDistance(o, [sign * N[i * 3], sign * N[i * 3 + 1], sign * N[i * 3 + 2]], max, from === 0 ? i : -1)
}
const gapFront = new Float32Array(n), gapBack = new Float32Array(n)
for (let i = 0; i < n; i++) {
  if (thickness[i] >= THIN) continue
  gapFront[i] = along(i, 1, 0.002, 0.12)
  gapBack[i] = along(i, -1, thickness[i] + 0.002, 0.12)
}
const smoothRing = (arr) => arr.map((v, i) => { const vals = [v, ...[...adj[i]].map((j) => arr[j])].sort((a, b) => a - b); return vals[vals.length >> 1] })
const thick = smoothRing(thickness)
const free = smoothRing(gapFront.map((v, i) => Math.min(v, gapBack[i])))
let cloth = new Uint8Array(n)
for (let i = 0; i < n; i++) if (thick[i] < THIN && free[i] > FREE && P[i * 3 + 1] > 0.02) cloth[i] = 1
// close gaps, drop specks
for (const [want, share] of [[1, 0.5], [1, 0.5], [0, 0.34], [0, 0.34]]) {
  const next = cloth.slice()
  for (let i = 0; i < n; i++) {
    if (cloth[i] === want) continue
    let h = 0; for (const j of adj[i]) h += cloth[j]
    const ratio = h / Math.max(1, adj[i].size)
    if (want === 1 ? ratio >= share : ratio < share) next[i] = want
  }
  cloth = next
}
// tiny isolated pieces are noise
{
  const seen = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (!cloth[i] || seen[i]) continue
    const piece = [i]; seen[i] = 1
    for (let k = 0; k < piece.length; k++) for (const j of adj[piece[k]]) if (cloth[j] && !seen[j]) { seen[j] = 1; piece.push(j) }
    if (piece.length < 40) for (const v of piece) cloth[v] = 0
  }
}
// distance along the surface from where the cloth is attached (Dijkstra from every non-cloth vertex)
const dist = new Float32Array(n).fill(Infinity)
const heap = []
const push = (d, i) => { heap.push([d, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p } }
const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = c * 2 + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m } } return top }
for (let i = 0; i < n; i++) if (!cloth[i]) { dist[i] = 0; push(0, i) }
while (heap.length) {
  const [d, i] = pop()
  if (d > dist[i]) continue
  for (const j of adj[i]) {
    if (!cloth[j]) continue
    const l = Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2])
    if (d + l < dist[j]) { dist[j] = d + l; push(d + l, j) }
  }
}
const sway = new Float32Array(n * 2)
for (let i = 0; i < n; i++) {
  if (!cloth[i]) continue
  const t = Math.min(1, (Number.isFinite(dist[i]) ? dist[i] : REACH) / REACH)
  sway[i * 2] = t * t * (3 - 2 * t)
  sway[i * 2 + 1] = P[i * 3 + 1] > 0.8 ? 1 : 0 // hair / head cloth: lighter, livelier
}
for (let pass = 0; pass < 3; pass++) {
  const next = sway.slice()
  for (let i = 0; i < n; i++) { let s = sway[i * 2], c = 1; for (const j of adj[i]) { s += sway[j * 2]; c++ } next[i * 2] = cloth[i] ? s / c : Math.min(sway[i * 2], s / c * 0.5) }
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
console.log(`${basename(FILE)}: ${cloth.reduce((a, b) => a + b, 0)} hanging vertices of ${n}`)

if (DEBUG) {
  // colours: red = swing weight, blue = forehead strings; texture removed so the colours show
  const colors = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) { colors[i * 4] = sway[i * 2]; colors[i * 4 + 1] = cloth[i] ? 0.25 : 0.6; colors[i * 4 + 2] = sway[i * 2 + 1] ? 1 : (cloth[i] ? 0.1 : 0.6); colors[i * 4 + 3] = 1 }
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
  await writeGlb(join(root, 'work', basename(FILE).replace('.glb', '-sway-debug.glb')), dbg, dbgBin)
}
