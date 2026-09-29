// Repaints the owner's welding-helmet model (scripts/gear/source/helmet-welding.glb, the first version of the Tagilla mask) into the
// «Сталь, царапины» variant: bare scratched steel instead of the printed art/inscription, and a cracked
// dark visor. The textures are baked from 3D position, so the fragmented Tripo UV atlas shows no seams.
//   node scripts/gear/repaint-helmet.mjs            -> src/assets/gear/helmet-steel.glb
//   node scripts/gear/repaint-helmet.mjs --debug    -> same, visor mask painted red (for tuning)
// The unused red channel of the roughness/metal texture carries a glass mask (255 = visor): the app
// turns it into a MeshPhysicalMaterial clearcoat so the visor reads as glass (see src/theme/gear/helmet3d.ts).
// Needs `sharp` (already a dependency of the build tooling).
import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const SOURCE = join(here, 'source', 'helmet-welding.glb')
const TARGET = join(root, 'src', 'assets', 'gear', 'helmet-steel.glb')
const DEBUG = process.argv.includes('--debug')
const N = 1024

// ---------- GLB in ----------
const glb = await readFile(SOURCE)
const jsonLength = glb.readUInt32LE(12)
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'))
const bin = glb.subarray(20 + jsonLength + 8)
const view = (accessorIndex, Type, comps) => {
  const accessor = gltf.accessors[accessorIndex]
  const bv = gltf.bufferViews[accessor.bufferView]
  const stride = (bv.byteStride ?? 0) / Type.BYTES_PER_ELEMENT || comps
  const base = ((bv.byteOffset ?? 0) + (accessor.byteOffset ?? 0)) / Type.BYTES_PER_ELEMENT
  const all = new Type(bin.buffer, bin.byteOffset, Math.floor(bin.byteLength / Type.BYTES_PER_ELEMENT))
  return { count: accessor.count, get: (i, c) => all[base + i * stride + c] }
}
const prim = gltf.meshes[0].primitives[0]
const P = view(prim.attributes.POSITION, Float32Array, 3)
const NM = view(prim.attributes.NORMAL, Float32Array, 3)
const UV = view(prim.attributes.TEXCOORD_0, Float32Array, 2)
const IDX = view(prim.indices, Uint32Array, 1)

// ---------- rasterise the mesh into UV space: object-space position + normal per texel ----------
const pos = new Float32Array(N * N * 3)
const nor = new Float32Array(N * N * 3)
const covered = new Uint8Array(N * N)
const triCount = IDX.count / 3
for (let t = 0; t < triCount; t++) {
  const v = [IDX.get(t * 3, 0), IDX.get(t * 3 + 1, 0), IDX.get(t * 3 + 2, 0)]
  const u = v.map((i) => UV.get(i, 0) * N - 0.5)
  const w = v.map((i) => UV.get(i, 1) * N - 0.5)
  const area = (u[1] - u[0]) * (w[2] - w[0]) - (u[2] - u[0]) * (w[1] - w[0])
  if (Math.abs(area) < 1e-9) continue
  const x0 = Math.max(0, Math.floor(Math.min(...u)) - 1), x1 = Math.min(N - 1, Math.ceil(Math.max(...u)) + 1)
  const y0 = Math.max(0, Math.floor(Math.min(...w)) - 1), y1 = Math.min(N - 1, Math.ceil(Math.max(...w)) + 1)
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let b0 = ((u[1] - x) * (w[2] - y) - (u[2] - x) * (w[1] - y)) / area
    let b1 = ((u[2] - x) * (w[0] - y) - (u[0] - x) * (w[2] - y)) / area
    let b2 = 1 - b0 - b1
    const inside = b0 >= -1e-4 && b1 >= -1e-4 && b2 >= -1e-4
    // conservative edge: texels whose centre is just outside still get the clamped value (reduces seams)
    const near = b0 >= -0.02 && b1 >= -0.02 && b2 >= -0.02
    if (!near) continue
    const i = y * N + x
    if (!inside && covered[i]) continue
    b0 = Math.max(0, b0); b1 = Math.max(0, b1); b2 = Math.max(0, b2)
    const s = b0 + b1 + b2
    b0 /= s; b1 /= s; b2 /= s
    for (let c = 0; c < 3; c++) {
      pos[i * 3 + c] = P.get(v[0], c) * b0 + P.get(v[1], c) * b1 + P.get(v[2], c) * b2
      nor[i * 3 + c] = NM.get(v[0], c) * b0 + NM.get(v[1], c) * b1 + NM.get(v[2], c) * b2
    }
    const l = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]) || 1
    for (let c = 0; c < 3; c++) nor[i * 3 + c] /= l
    covered[i] = inside ? 2 : Math.max(covered[i], 1)
  }
}
// grow charts outward so mip-mapping and filtering never pull in empty texels
for (let pass = 0; pass < 6; pass++) {
  const grown = []
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x
    if (covered[i]) continue
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue
      const j = yy * N + xx
      if (covered[j]) { grown.push([i, j]); break }
    }
  }
  for (const [i, j] of grown) { for (let c = 0; c < 3; c++) { pos[i * 3 + c] = pos[j * 3 + c]; nor[i * 3 + c] = nor[j * 3 + c] } covered[i] = 1 }
}

// ---------- noise ----------
let seed = 1337
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
const hash = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296 }
const smooth = (t) => t * t * (3 - 2 * t)
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi)
  const l = (a, b, t) => a + (b - a) * t
  return l(
    l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), xf), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), xf), yf),
    l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), xf), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), xf), yf),
    zf,
  )
}
const fbm = (x, y, z, oct = 4) => { let s = 0, a = 0.5, f = 1; for (let o = 0; o < oct; o++) { s += a * noise(x * f, y * f, z * f); f *= 2.03; a *= 0.5 } return s / (1 - 0.5 ** oct) }

// ---------- visor: the dark glass inside the front window ----------
// The glass sits recessed in the front window (front = +z): model-space box measured from the mesh.
const VISOR = { x0: -0.2, x1: 0.2, y0: 0.562, y1: 0.69, zMax: 0.255 }
const isVisor = new Uint8Array(N * N)
for (let i = 0; i < N * N; i++) {
  if (!covered[i]) continue
  const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
  if (x > VISOR.x0 && x < VISOR.x1 && y > VISOR.y0 && y < VISOR.y1 && z < VISOR.zMax && z > 0.15 && nor[i * 3 + 2] > 0.3) isVisor[i] = 1
}
// Cracks: an impact point with radial cracks that branch, plus a few concentric arcs, in the visor plane.
const IMPACT = { x: 0.065, y: 0.632 }
const cracks = []
for (let k = 0; k < 13; k++) {
  let a = (k / 13) * Math.PI * 2 + (rand() - 0.5) * 0.4
  let x = IMPACT.x, y = IMPACT.y
  const steps = 6 + Math.floor(rand() * 6)
  for (let s = 0; s < steps; s++) {
    const len = 0.012 + rand() * 0.02
    const nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len
    cracks.push([x, y, nx, ny, 0.0028 - s * 0.00014])
    if (rand() < 0.22) { const b = a + (rand() < 0.5 ? 1 : -1) * (0.5 + rand() * 0.5); cracks.push([nx, ny, nx + Math.cos(b) * 0.035, ny + Math.sin(b) * 0.035, 0.0018]) }
    x = nx; y = ny; a += (rand() - 0.5) * 0.5
  }
}
for (const r of [0.018, 0.038, 0.065]) {
  const from = rand() * Math.PI * 2
  const span = 1.6 + rand() * 2.4
  const parts = 10
  for (let s = 0; s < parts; s++) {
    const a0 = from + (span * s) / parts, a1 = from + (span * (s + 1)) / parts
    const r0 = r * (1 + (rand() - 0.5) * 0.18), r1 = r * (1 + (rand() - 0.5) * 0.18)
    cracks.push([IMPACT.x + Math.cos(a0) * r0 * 1.3, IMPACT.y + Math.sin(a0) * r0, IMPACT.x + Math.cos(a1) * r1 * 1.3, IMPACT.y + Math.sin(a1) * r1, 0.0019])
  }
}
const segDist = (px, py, [ax, ay, bx, by]) => {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - ax - dx * t, py - ay - dy * t)
}

// ---------- scratches: short strokes laid on the surface, stored in a 3D grid ----------
const tris = []
let totalArea = 0
for (let t = 0; t < triCount; t++) {
  const v = [0, 1, 2].map((k) => IDX.get(t * 3 + k, 0))
  const p = v.map((i) => [P.get(i, 0), P.get(i, 1), P.get(i, 2)])
  const e1 = p[1].map((c, k) => c - p[0][k]), e2 = p[2].map((c, k) => c - p[0][k])
  const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
  const area = Math.hypot(...cr) / 2
  if (area <= 0) continue
  totalArea += area
  tris.push({ p, n: cr.map((c) => c / (area * 2)), cum: totalArea })
}
const pickTri = () => { const r = rand() * totalArea; let lo = 0, hi = tris.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (tris[m].cum < r) lo = m + 1; else hi = m } return tris[lo] }
const CELL = 0.04
const grid = new Map()
const key = (x, y, z) => `${x},${y},${z}`
const scratches = []
function addScratch(count, minLen, maxLen, width, depth, curve = 0.25) {
  for (let s = 0; s < count; s++) {
    const tri = pickTri()
    let a = rand(), b = rand(); if (a + b > 1) { a = 1 - a; b = 1 - b }
    let p = tri.p[0].map((c, k) => c + (tri.p[1][k] - c) * a + (tri.p[2][k] - c) * b)
    const n = tri.n
    // a random direction in the tangent plane; mostly diagonal/horizontal like real handling wear
    const rnd = [rand() - 0.5, (rand() - 0.5) * 0.6, rand() - 0.5]
    const dn = rnd[0] * n[0] + rnd[1] * n[1] + rnd[2] * n[2]
    let d = rnd.map((c, k) => c - dn * n[k]); const dl = Math.hypot(...d) || 1; d = d.map((c) => c / dl)
    const len = minLen + rand() * (maxLen - minLen)
    const pieces = Math.max(1, Math.round(len / 0.03))
    for (let q = 0; q < pieces; q++) {
      const bend = (rand() - 0.5) * curve
      const side = [n[1] * d[2] - n[2] * d[1], n[2] * d[0] - n[0] * d[2], n[0] * d[1] - n[1] * d[0]]
      d = d.map((c, k) => c + side[k] * bend); const l2 = Math.hypot(...d) || 1; d = d.map((c) => c / l2)
      const step = len / pieces
      const e = p.map((c, k) => c + d[k] * step)
      const w = width * (0.6 + rand() * 0.8)
      const seg = { a: p, b: e, n, w, depth: depth * (0.6 + rand() * 0.8), bright: 0.55 + rand() * 0.45 }
      const idx = scratches.push(seg) - 1
      const lo = [0, 1, 2].map((k) => Math.floor((Math.min(p[k], e[k]) - w - 0.01) / CELL))
      const hi = [0, 1, 2].map((k) => Math.floor((Math.max(p[k], e[k]) + w + 0.01) / CELL))
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
        const k = key(x, y, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(idx)
      }
      p = e
    }
  }
}
addScratch(1100, 0.008, 0.04, 0.0012, 0.25, 0.15) // fine handling scuffs
addScratch(200, 0.05, 0.16, 0.0018, 0.55, 0.2) // longer scrapes
addScratch(34, 0.12, 0.3, 0.0034, 1, 0.3) // deep gouges
function scratchAt(i) {
  const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2]
  const list = grid.get(key(Math.floor(px / CELL), Math.floor(py / CELL), Math.floor(pz / CELL)))
  if (!list) return null
  let best = 0, bright = 0
  for (const idx of list) {
    const s = scratches[idx]
    if (Math.abs(s.n[0] * nor[i * 3] + s.n[1] * nor[i * 3 + 1] + s.n[2] * nor[i * 3 + 2]) < 0.6) continue
    const ab = [s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]]
    const ap = [px - s.a[0], py - s.a[1], pz - s.a[2]]
    const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1)))
    const dist = Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t)
    if (dist > s.w) continue
    const v = (1 - (dist / s.w) ** 2) * s.depth
    if (v > best) { best = v; bright = s.bright }
  }
  return best > 0 ? { v: best, bright } : null
}

// ---------- bake ----------
const base = Buffer.alloc(N * N * 3)
const rm = Buffer.alloc(N * N * 3)
const height = new Float32Array(N * N)
const clamp01 = (v) => Math.min(1, Math.max(0, v))
for (let i = 0; i < N * N; i++) {
  const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
  let r, g, b, rough, metal
  if (isVisor[i]) {
    // smoked welding glass, slightly green, with white fractures and fine chipping around the impact
    let crack = 0
    for (const c of cracks) { const d = segDist(x, y, c); if (d < c[4]) crack = Math.max(crack, 1 - d / c[4]) }
    const dImpact = Math.hypot((x - IMPACT.x) / 1.3, y - IMPACT.y)
    const crush = clamp01(1 - dImpact / 0.014) * (0.6 + 0.4 * noise(x * 900, y * 900, 3))
    const smudge = fbm(x * 30, y * 30, 7, 3)
    r = 0.012 + smudge * 0.012; g = 0.02 + smudge * 0.014; b = 0.016 + smudge * 0.012
    const white = Math.max(crack * 0.85, crush)
    r += (0.78 - r) * white; g += (0.8 - g) * white; b += (0.78 - b) * white
    rough = 0.03 + white * 0.55 + smudge * 0.05
    metal = 0
    height[i] = -crack * 0.9 - crush * 0.5
    if (DEBUG) { r = 1; g = 0; b = 0 }
  } else {
    // steel: large darker oxidised blotches, fine grain, grime collecting low on the shell
    const blot = fbm(x * 4, y * 4, z * 4)
    const grain = noise(x * 260, y * 60, z * 260)
    const grime = clamp01((0.25 - y) * 2.2) * 0.35 + clamp01((fbm(x * 9 + 5, y * 9, z * 9) - 0.55) * 2.5) * 0.4
    let v = 0.14 + (blot - 0.5) * 0.12 + (grain - 0.5) * 0.04 - grime * 0.07
    rough = 0.46 + (blot - 0.5) * 0.3 + grime * 0.3 + (grain - 0.5) * 0.08
    const sc = scratchAt(i)
    if (sc) {
      const s = clamp01(sc.v)
      v += (0.5 * sc.bright + 0.16 - v) * s * 0.85
      rough -= (rough - 0.18) * s
      height[i] = -s
    }
    const warm = (fbm(x * 6 + 11, y * 6, z * 6) - 0.5) * 0.05
    r = v + warm; g = v; b = v - warm * 0.6 + 0.012
    metal = 0.95
  }
  base[i * 3] = Math.round(clamp01(r) * 255); base[i * 3 + 1] = Math.round(clamp01(g) * 255); base[i * 3 + 2] = Math.round(clamp01(b) * 255)
  rm[i * 3] = isVisor[i] ? 255 : 0; rm[i * 3 + 1] = Math.round(clamp01(rough) * 255); rm[i * 3 + 2] = Math.round(clamp01(metal) * 255)
}
// tangent-space normal map from the height field (flat everywhere else: the embossed art is gone)
const normal = Buffer.alloc(N * N * 3)
const STRENGTH = 0.9
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const i = y * N + x
  const h = (xx, yy) => height[Math.min(N - 1, Math.max(0, yy)) * N + Math.min(N - 1, Math.max(0, xx))]
  const dx = (h(x + 1, y) - h(x - 1, y)) * STRENGTH
  const dy = (h(x, y + 1) - h(x, y - 1)) * STRENGTH
  const l = Math.hypot(dx, dy, 1)
  normal[i * 3] = Math.round((-dx / l * 0.5 + 0.5) * 255)
  normal[i * 3 + 1] = Math.round((dy / l * 0.5 + 0.5) * 255)
  normal[i * 3 + 2] = Math.round((1 / l * 0.5 + 0.5) * 255)
}

// ---------- GLB out: same mesh, three new textures ----------
const encode = (raw, quality) => sharp(raw, { raw: { width: N, height: N, channels: 3 } }).webp({ quality, effort: 6 }).toBuffer()
const [baseWebp, rmWebp, normalWebp] = await Promise.all([encode(base, 88), encode(rm, 85), encode(normal, 90)])
const out = structuredClone(gltf)
const material = out.materials[0]
material.name = 'helmet-steel'
delete material.extensions
out.extensionsUsed = ['EXT_texture_webp']
const texSource = (slot) => out.textures[slot.index].extensions.EXT_texture_webp.source
const replacements = new Map([
  [texSource(material.pbrMetallicRoughness.baseColorTexture), baseWebp],
  [texSource(material.pbrMetallicRoughness.metallicRoughnessTexture), rmWebp],
  [texSource(material.normalTexture), normalWebp],
])
out.images.forEach((image, i) => { image.name = ['basecolor', 'roughness-metal', 'normal'][[...replacements.keys()].indexOf(i)] ?? image.name })
const chunks = []
let offset = 0
const align = (n) => (n + 3) & ~3
out.bufferViews = gltf.bufferViews.map((bv, index) => {
  const imageIndex = gltf.images.findIndex((image) => image.bufferView === index)
  const data = imageIndex >= 0 ? replacements.get(imageIndex) : bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)
  const next = { ...bv, byteOffset: offset, byteLength: data.length }
  chunks.push(data)
  const pad = align(data.length) - data.length
  if (pad) chunks.push(Buffer.alloc(pad))
  offset += align(data.length)
  return next
})
out.buffers = [{ byteLength: offset }]
out.asset = { ...out.asset, generator: 'scripts/gear/repaint-helmet.mjs' }
let json = Buffer.from(JSON.stringify(out), 'utf8')
json = Buffer.concat([json, Buffer.alloc(align(json.length) - json.length, 0x20)])
const binChunk = Buffer.concat(chunks)
const header = Buffer.alloc(12)
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + binChunk.length, 8)
const chunkHeader = (length, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(length, 0); h.writeUInt32LE(type, 4); return h }
await writeFile(TARGET, Buffer.concat([header, chunkHeader(json.length, 0x4e4f534a), json, chunkHeader(binChunk.length, 0x004e4942), binChunk]))
console.log(`helmet-steel.glb ${(12 + 16 + json.length + binChunk.length) / 1024 | 0} KB, ${scratches.length} scratch strokes, ${isVisor.reduce((a, b) => a + b, 0)} visor texels`)
