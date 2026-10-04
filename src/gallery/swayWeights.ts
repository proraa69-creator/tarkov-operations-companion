/**
 * Finds the loose, hanging parts of a boss model — cloth flaps, coat and jacket hems, hoods, straps, cords,
 * dreadlocks — and gives every vertex a swing weight: the analysis the Gallery's secondary physics is built from
 * (physics/rig.ts).
 *
 * The Tripo exports are one fused mesh with no skeleton, so parts are told apart by shape:
 * 1. on a voxel grid the surface is rasterised and the inside filled (flood fill of the outside);
 * 2. morphological openings of that solid: what survives a ball of CORE_RADIUS is the rigid body (torso,
 *    head, limbs, boots, weapon bodies); what only a POUCH_RADIUS ball removes is a lump (pouch, pocket — or
 *    a hand, told apart below); the rest is thin (sheets, straps, cords, strands);
 * 3. a cape lying on the back merges with it in the voxels; on the mesh those patches are islands inside the
 *    sheet, so they are handed back to the sheet and the whole cape hangs from its top seam only;
 * 4. thin pieces hang from their highest seam: the weight grows along the surface from it (0 → 1 over REACH)
 *    and drops back to 0 near every other seam (PIN), so nothing tears or stretches where it is fused.
 *    Rigid, whatever their shape: straight rods and long straight pieces (barrels, hafts, blades), anything
 *    held in front of the chest (weapons), pieces hanging from the ankles;
 * 5. cords — rifle slings, ropes — are split out of the weapon or hand they are fused into (STRAND_RADIUS)
 *    and swing if they hang; cords, hair and dreads are marked livelier;
 * 6. pouches on the torso, hips and thighs swing a little (POUCH_SWING) from their top seam.
 * 7. per-model hints (bossSwayHints.ts), measured on each model by hand, have the last word: weapons stay
 *    rigid whatever their shape, holsters/backpacks/buckles swing as one whole piece, antennas bend towards the
 *    tip, hair hangs from its roots.
 * Coincident vertices (UV seams) always get the same weight, so the surface never cracks open.
 * Runs once per model, off the main thread (physics/rig.worker.ts): about 0.2–1.5 s for a 30k-vertex model.
 */
import type { BossSwayHints, HintBox } from './bossSwayHints'

const CELLS_PER_HEIGHT = 150
/** Parts thinner than this (radius, fraction of the model height) count as loose. */
const CORE_RADIUS = 0.02
/** Distance along a loose part (fraction of height) over which its weight rises from 0 to 1. */
const REACH = 0.18
/** Any other place a loose part is fused to the body pins it: the weight is back to 0 within this distance. */
const PIN = 0.04
/** A loose part swings only if it is attached within this distance of the body's vertical axis (fraction of height). */
const ATTACH_RADIUS = 0.12
/** Radius of the second opening: lumps thinner than this on the body are pouches and pockets. */
const POUCH_RADIUS = 0.034
/** How far a pouch swings compared with cloth. */
const POUCH_SWING = 0.45
/** Strands thinner than this (radius, fraction of height) inside a weapon or a hand are cords (slings, ropes). */
const STRAND_RADIUS = 0.013
/** Distance along a cord or strand over which its weight reaches 1 (they are short but swing fully). */
const CORD_REACH = 0.07
/** Attachments above this height (fraction) are head/hair: lighter and livelier. */
const HEAD_HEIGHT = 0.82
/** Hint boxes fade out over this distance outside the box (fraction of height), so nothing tears at their edge. */
const HINT_MARGIN = 0.014
/** Whole pieces fade out faster: the leg or the back they sit on must not be dragged along. */
const PIECE_MARGIN = 0.007

export interface SwayOptions {
  coreRadius?: number
  /** Hand-made corrections for this model (see bossSwayHints.ts). */
  hints?: BossSwayHints
  /** Also return each vertex's class (debug views): 0 body, 1 swinging cloth, 2 cord/hair/antenna, 3 pouch, 4 held rigid, 5 whole piece. */
  debug?: boolean
  /** Also return the analysis internals the physics rig is built from (physics/rig.ts); stays in the worker. */
  internals?: boolean
}

/** Kind of a loose vertex (SwayInternals.kind). */
export const KIND = { body: 0, cloth: 1, strand: 2, pouch: 3, rigid: 4, piece: 5 } as const
/** What a strand (kind 2) is (SwayInternals.strand). */
export const STRAND_TYPE = { cord: 0, hair: 1, antenna: 2 } as const

/** Everything the physics rig needs from the analysis, per welded vertex (index = the first vertex at a position). */
export interface SwayInternals {
  /** Every vertex → the first vertex at the same position (UV seams welded). */
  weld: Int32Array
  /** Mesh neighbours of every welded vertex. */
  neighbours: number[][]
  /** Swing weight 0..1 (after smoothing and hints). */
  w: Float32Array
  /** KIND per welded vertex. */
  kind: Uint8Array
  /** STRAND_TYPE per welded vertex (meaningful where kind = strand). */
  strand: Uint8Array
  /** Whole piece (hints.pieces index) per welded vertex, -1 = none. */
  piece: Int16Array
  /** Rigid body voxels (the opening's core): 1 = body. */
  core: Uint8Array
  grid: { ox: number; oy: number; oz: number; cell: number; nx: number; ny: number; nz: number }
  minY: number
  height: number
  /** Centre of the model's bounding box (x, z): the hints' origin. */
  cx: number
  cz: number
}

export interface SwayWeights {
  /** Per vertex: x = swing weight 0..1, y = liveliness 0..1 (hair, dreads, cords and straps swing more). */
  weights: Float32Array
  /** Body axis (model space) the swing turns around. */
  pivotX: number
  pivotZ: number
  minY: number
  height: number
  /** Per vertex, only when the model has whole swinging pieces: pivot x, y, z (model space) and the swing amount 0..1. */
  parts?: Float32Array
  /** Share of vertices that move at all (for diagnostics). */
  share: number
  kind?: Uint8Array
  info?: string[]
  internals?: SwayInternals
}

const smooth = (t: number) => { const c = t < 0 ? 0 : t > 1 ? 1 : t; return c * c * (3 - 2 * c) }

export function computeSwayWeights(position: ArrayLike<number>, index: ArrayLike<number> | null, options: SwayOptions = {}): SwayWeights | null {
  const coreRadius = options.coreRadius ?? CORE_RADIUS
  const n = Math.floor(position.length / 3)
  if (n < 3) return null
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < n; i++) {
    const x = position[i * 3], y = position[i * 3 + 1], z = position[i * 3 + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  const height = maxY - minY
  if (!(height > 0)) return null
  const cell = height / CELLS_PER_HEIGHT
  const PAD = 2
  const ox = minX - PAD * cell, oy = minY - PAD * cell, oz = minZ - PAD * cell
  const nx = Math.ceil((maxX - minX) / cell) + PAD * 2 + 1
  const ny = Math.ceil((maxY - minY) / cell) + PAD * 2 + 1
  const nz = Math.ceil((maxZ - minZ) / cell) + PAD * 2 + 1
  const N = nx * ny * nz
  if (N > 8_000_000) return null
  const sy = nx, sz = nx * ny
  const cellOf = (x: number, y: number, z: number) => {
    const cx = Math.floor((x - ox) / cell), cy = Math.floor((y - oy) / cell), cz = Math.floor((z - oz) / cell)
    return cx < 0 || cy < 0 || cz < 0 || cx >= nx || cy >= ny || cz >= nz ? -1 : cx + cy * sy + cz * sz
  }

  // 1. surface voxels
  const SURFACE = 1, OUTSIDE = 2
  const grid = new Uint8Array(N)
  const triCount = index ? Math.floor(index.length / 3) : Math.floor(n / 3)
  for (let t = 0; t < triCount; t++) {
    const a = index ? index[t * 3] : t * 3, b = index ? index[t * 3 + 1] : t * 3 + 1, c = index ? index[t * 3 + 2] : t * 3 + 2
    const ax = position[a * 3], ay = position[a * 3 + 1], az = position[a * 3 + 2]
    const ux = position[b * 3] - ax, uy = position[b * 3 + 1] - ay, uz = position[b * 3 + 2] - az
    const vx = position[c * 3] - ax, vy = position[c * 3 + 1] - ay, vz = position[c * 3 + 2] - az
    const edge = Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz), Math.hypot(ux - vx, uy - vy, uz - vz))
    const m = Math.max(1, Math.ceil(edge / (cell * 0.5)))
    for (let i = 0; i <= m; i++) for (let j = 0; j <= m - i; j++) {
      const s = i / m, r = j / m
      const k = cellOf(ax + ux * s + vx * r, ay + uy * s + vy * r, az + uz * s + vz * r)
      if (k >= 0) grid[k] = SURFACE
    }
  }
  // 2. outside = flood fill from the border, walled by the surface grown by one voxel (closes pinholes)
  const wall = new Uint8Array(N)
  for (let k = 0; k < N; k++) {
    if (grid[k] !== SURFACE) continue
    wall[k] = 1
    const x = k % nx, y = Math.floor(k / sy) % ny, z = Math.floor(k / sz)
    if (x > 0) wall[k - 1] = 1; if (x < nx - 1) wall[k + 1] = 1
    if (y > 0) wall[k - sy] = 1; if (y < ny - 1) wall[k + sy] = 1
    if (z > 0) wall[k - sz] = 1; if (z < nz - 1) wall[k + sz] = 1
  }
  const queue = new Int32Array(N)
  let head = 0, tail = 0
  const visitOutside = (k: number) => { if (!wall[k] && grid[k] !== OUTSIDE) { grid[k] = OUTSIDE; queue[tail++] = k } }
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) visitOutside(x + y * sy + z * sz)
  }
  const flood = () => {
    while (head < tail) {
      const k = queue[head++]
      const x = k % nx, y = Math.floor(k / sy) % ny, z = Math.floor(k / sz)
      if (x > 0) visitOutside(k - 1); if (x < nx - 1) visitOutside(k + 1)
      if (y > 0) visitOutside(k - sy); if (y < ny - 1) visitOutside(k + sy)
      if (z > 0) visitOutside(k - sz); if (z < nz - 1) visitOutside(k + sz)
    }
  }
  flood()
  // the grown wall made everything one voxel fatter: peel that layer off again (never the surface itself)
  const peel: number[] = []
  for (let k = 0; k < N; k++) {
    if (grid[k] !== 0) continue
    const x = k % nx, y = Math.floor(k / sy) % ny, z = Math.floor(k / sz)
    if ((x > 0 && grid[k - 1] === OUTSIDE) || (x < nx - 1 && grid[k + 1] === OUTSIDE) || (y > 0 && grid[k - sy] === OUTSIDE)
      || (y < ny - 1 && grid[k + sy] === OUTSIDE) || (z > 0 && grid[k - sz] === OUTSIDE) || (z < nz - 1 && grid[k + sz] === OUTSIDE)) peel.push(k)
  }
  for (const k of peel) grid[k] = OUTSIDE
  let solidCount = 0
  const solid = new Uint8Array(N)
  for (let k = 0; k < N; k++) if (grid[k] !== OUTSIDE) { solid[k] = 1; solidCount++ }

  // 3. opening: erode (distance to the outside > r), then grow back by r (distance to the eroded set <= r)
  const r = coreRadius * CELLS_PER_HEIGHT
  const toOutside = distanceTransform(solid, 0, nx, ny, nz)
  const eroded = new Uint8Array(N)
  for (let k = 0; k < N; k++) if (solid[k] && toOutside[k] > r * r) eroded[k] = 1
  const toEroded = distanceTransform(eroded, 1, nx, ny, nz)
  const core = new Uint8Array(N)
  let coreCount = 0
  const grow = (r + 1) * (r + 1)
  for (let k = 0; k < N; k++) if (solid[k] && toEroded[k] <= grow) { core[k] = 1; coreCount++ }
  // not watertight (inside leaked out) or nothing solid: no reliable split, leave the model rigid
  if (coreCount < solidCount * 0.3) return null
  // a second, wider opening: what it removes on top of the first is pouches, pockets, buckles (and hands,
  // forearms, weapon parts — told apart below)
  const r2 = POUCH_RADIUS * CELLS_PER_HEIGHT
  const eroded2 = new Uint8Array(N)
  for (let k = 0; k < N; k++) if (solid[k] && toOutside[k] > r2 * r2) eroded2[k] = 1
  const toEroded2 = distanceTransform(eroded2, 1, nx, ny, nz)
  const core2 = new Uint8Array(N)
  const grow2 = (r2 + 1) * (r2 + 1)
  for (let k = 0; k < N; k++) if (solid[k] && toEroded2[k] <= grow2) core2[k] = 1

  // body axis per height layer: centre of the core, smoothed over a few layers
  const axisX = new Float64Array(ny), axisZ = new Float64Array(ny), axisN = new Float64Array(ny)
  for (let k = 0; k < N; k++) {
    if (!core[k]) continue
    const y = Math.floor(k / sy) % ny
    axisX[y] += k % nx; axisZ[y] += Math.floor(k / sz); axisN[y]++
  }
  let pivotX = 0, pivotZ = 0, pivotN = 0
  const layerX = new Float64Array(ny), layerZ = new Float64Array(ny)
  for (let y = 0; y < ny; y++) {
    let sx = 0, sz2 = 0, sn = 0
    for (let d = -4; d <= 4; d++) { const yy = y + d; if (yy >= 0 && yy < ny) { sx += axisX[yy]; sz2 += axisZ[yy]; sn += axisN[yy] } }
    layerX[y] = sn ? sx / sn : nx / 2; layerZ[y] = sn ? sz2 / sn : nz / 2
    pivotX += axisX[y]; pivotZ += axisZ[y]; pivotN += axisN[y]
  }

  // 4. on the mesh (UV seams welded): a vertex is loose when its voxel is not core
  const weld = new Int32Array(n)
  {
    const byPos = new Map<string, number>()
    for (let i = 0; i < n; i++) {
      const key = `${Math.round(position[i * 3] * 1e5)},${Math.round(position[i * 3 + 1] * 1e5)},${Math.round(position[i * 3 + 2] * 1e5)}`
      const first = byPos.get(key)
      if (first === undefined) { byPos.set(key, i); weld[i] = i } else weld[i] = first
    }
  }
  const neighbours: number[][] = Array.from({ length: n }, () => [])
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = weld[index ? index[t * 3 + e] : t * 3 + e], b = weld[index ? index[t * 3 + (e + 1) % 3] : t * 3 + (e + 1) % 3]
      if (a !== b) { neighbours[a].push(b); neighbours[b].push(a) }
    }
  }
  // vertex classes: 0 body, 1 thin (sheets, straps, cords, strands), 2 medium (pouch candidates)
  const BODY = 0, THIN = 1, MEDIUM = 2
  const cls = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (weld[i] !== i) continue
    const k = cellOf(position[i * 3], position[i * 3 + 1], position[i * 3 + 2])
    if (k < 0 || !solid[k]) continue
    cls[i] = !core[k] ? THIN : !core2[k] ? MEDIUM : BODY
  }
  // A cape lying against the back is merged with it in the voxels, so patches of it read as body (or as a
  // lump) and pin it there. On the mesh those patches are islands inside the sheet — they share no triangles
  // with the body — so every small island mostly surrounded by thin vertices is part of the sheet.
  const absorb = (from: number, share: number) => {
    const comp = new Int32Array(n).fill(-1)
    const sizes: number[] = [], thinEdge: number[] = [], allEdge: number[] = []
    for (let i = 0; i < n; i++) {
      if (weld[i] !== i || cls[i] !== from || comp[i] >= 0) continue
      const id = sizes.length
      const stack = [i]; comp[i] = id
      let size = 0, thin = 0, all = 0
      while (stack.length) {
        const v = stack.pop()!
        size++
        for (const j of neighbours[v]) {
          if (cls[j] === from) { if (comp[j] < 0) { comp[j] = id; stack.push(j) } } else { all++; if (cls[j] === THIN) thin++ }
        }
      }
      sizes.push(size); thinEdge.push(thin); allEdge.push(all)
    }
    for (let i = 0; i < n; i++) {
      const id = comp[i]
      if (id >= 0 && sizes[id] < n * 0.04 && allEdge[id] > 0 && thinEdge[id] >= allEdge[id] * share) cls[i] = THIN
    }
  }
  // capes the hints mark as cloth: their thick folds are cloth, not lumps (bossSwayHints.ts `cloth`)
  const cx0 = (minX + maxX) / 2, cz0 = (minZ + maxZ) / 2
  const inCloth = (v: number) => (options.hints?.cloth ?? []).some((box) => outside(box, (position[v * 3] - cx0) / height, (position[v * 3 + 1] - minY) / height, (position[v * 3 + 2] - cz0) / height) === 0)
  if (options.hints?.cloth?.length) for (let i = 0; i < n; i++) if (weld[i] === i && cls[i] === MEDIUM && inCloth(i)) cls[i] = THIN
  absorb(MEDIUM, 0.6)
  absorb(BODY, 0.6)

  const edge = (a: number, b: number) => Math.hypot(position[a * 3] - position[b * 3], position[a * 3 + 1] - position[b * 3 + 1], position[a * 3 + 2] - position[b * 3 + 2])
  /** Distance along the surface from the seeds through vertices of the given class. */
  const walk = (seeds: number[], through: number) => {
    const dist = new Float32Array(n).fill(Infinity)
    const heap = new MinHeap()
    for (const a of seeds) if (dist[a] !== 0) { dist[a] = 0; heap.push(0, a) }
    while (heap.size) {
      const i = heap.pop()
      for (const j of neighbours[i]) {
        if (cls[j] !== through) continue
        const d = dist[i] + edge(i, j)
        if (d < dist[j] - 1e-9) { dist[j] = d; heap.push(d, j) }
      }
    }
    return dist
  }
  const layerOf = (y: number) => Math.max(0, Math.min(ny - 1, Math.floor((y - oy) / cell)))
  /** Horizontal offset of a point from the body axis at its height (fraction of height) and how far it is in front. */
  const offset = (v: number) => {
    const layer = layerOf(position[v * 3 + 1])
    const dx = (position[v * 3] - ox) / cell - 0.5 - layerX[layer], dz = (position[v * 3 + 2] - oz) / cell - 0.5 - layerZ[layer]
    return { radial: Math.hypot(dx, dz) * cell / height, front: dz * cell / height }
  }
  interface Piece { members: number[]; seams: Set<number>; top: number; topY: number; box: number[] }
  const collect = (want: number, stopAt: (c: number) => boolean) => {
    const pieceOf = new Int32Array(n).fill(-1)
    const list: Piece[] = []
    for (let i = 0; i < n; i++) {
      if (cls[i] !== want || pieceOf[i] >= 0 || weld[i] !== i) continue
      const members = [i], seams = new Set<number>()
      pieceOf[i] = list.length
      for (let m = 0; m < members.length; m++) for (const j of neighbours[members[m]]) {
        if (cls[j] === want) { if (pieceOf[j] < 0) { pieceOf[j] = list.length; members.push(j) } } else if (stopAt(cls[j])) seams.add(j)
      }
      let top = -1
      for (const a of seams) if (top < 0 || position[a * 3 + 1] > position[top * 3 + 1]) top = a
      const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
      for (const m of members) for (let c = 0; c < 3; c++) { box[c] = Math.min(box[c], position[m * 3 + c]); box[c + 3] = Math.max(box[c + 3], position[m * 3 + c]) }
      list.push({ members, seams, top, topY: top < 0 ? 0 : (position[top * 3 + 1] - minY) / height, box })
    }
    return { pieceOf, list }
  }

  const raw = new Float32Array(n), lively = new Float32Array(n), kind = new Uint8Array(n), strand = new Uint8Array(n)
  const debugInfo: string[] = []

  // 6. pouches and pockets: small lumps on the torso, hips and thighs swing a little from their top seam as
  // if hung there (hands, forearms and weapons are larger, or sit in front of the chest or out at the sides)
  const pouches = collect(MEDIUM, (c) => c === BODY)
  for (const p of pouches.list) {
    if (p.top < 0 || p.members.length < 12) continue
    const extent = Math.max(p.box[3] - p.box[0], p.box[4] - p.box[1], p.box[5] - p.box[2]) / height
    const { radial, front } = offset(p.top)
    const inFront = front > 0.03 && p.topY > 0.58
    if (extent > 0.14 || p.topY < 0.15 || p.topY > 0.8 || radial > ATTACH_RADIUS + 0.02 || inFront) { for (const m of p.members) kind[m] = 4; continue }
    const topSeams = [...p.seams].filter((a) => position[a * 3 + 1] > position[p.top * 3 + 1] - 0.02 * height)
    const from = walk(topSeams, MEDIUM)
    const drop = Math.max(0.03 * height, position[p.top * 3 + 1] - p.box[1])
    for (const m of p.members) {
      const hang = smooth((position[p.top * 3 + 1] - position[m * 3 + 1]) / (0.02 * height))
      raw[m] = POUCH_SWING * smooth(from[m] / drop) * hang
      kind[m] = 3
    }
  }

  // 7. thin pieces: cloth, straps, cords and strands hang from their highest seam
  const thins = collect(THIN, () => true)
  const seedsAny: number[] = [], seedsTop: number[] = []
  const areas = pieceAreas(thins.pieceOf, thins.list.length, index, triCount, weld, position)
  const accept: { cord: boolean; hair: boolean; reach: number; base: number; onBody: number }[] = []
  for (const p of thins.list) {
    const top = p.top
    let ok = top >= 0 && p.members.length >= 12
    let cord = false, hair = false, onBody = 1
    if (ok) {
      hair = p.topY > HEAD_HEIGHT
      const { radial, front } = offset(top)
      const topPos = position[top * 3 + 1]
      let cy = 0
      for (const m of p.members) cy += position[m * 3 + 1]
      cy /= p.members.length
      const spanY = p.box[4] - p.box[1]
      const hanging = topPos - cy > 0.3 * spanY && topPos - p.box[1] > 0.03 * height
      // cord: a thin strand or loop (its surface area per length is small) hanging down — a rope, a sling
      const seamsTop = [...p.seams].filter((a) => position[a * 3 + 1] > topPos - 0.08 * height)
      const along = walk(seamsTop, THIN)
      let longest = 0
      for (const m of p.members) if (Number.isFinite(along[m])) longest = Math.max(longest, along[m])
      const girth = areas[thins.pieceOf[p.members[0]]] / Math.max(longest, 1e-6) / height
      // (not wider than a hand's reach sideways: a bow limb with its string is not a cord)
      const narrow = Math.max(p.box[3] - p.box[0], p.box[5] - p.box[2]) < 0.25 * height
      cord = hanging && narrow && girth < 0.06 && longest > 0.03 * height
      // a long piece this straight is a blade or a haft (a sword, an axe), however it hangs
      const rod = !hair && (isRod(p.members, position, height) || (longest > 0.3 * height && principal(p.members, position).share > 0.94))
      const zSpan = p.box[5] - p.box[2]
      // weapons in the hands: in front of the chest, or bulky in depth in front; a tabard or loincloth there
      // is flat and long, a coat skirt wraps round to the back
      const drop = (topPos - p.box[1]) / height
      const flatAndLong = zSpan < 0.06 * height && drop > 0.2
      const wraps = (p.box[2] - oz) / cell - 0.5 < layerZ[layerOf(topPos)] - 0.02 * height / cell
      const heldInFront = front > 0.03 && (p.topY > 0.58 || zSpan > 0.05 * height) && !flatAndLong && !wraps
      const behind = smooth(-front / 0.03)
      const reach = ATTACH_RADIUS + smooth((p.topY - 0.62) / 0.12) * behind * 0.1
      // a long sheet hanging close around the body is a cape or a coat skirt even when its highest seam is
      // out at the side (a weapon or a shield is held in front, a scythe blade or a bow away from the body)
      let meanRadial = 0
      for (const m of p.members) meanRadial += offset(m).radial
      meanRadial /= p.members.length
      const sheet = longest > 0.3 * height && girth < 0.3 && drop > 0.2 && !heldInFront && meanRadial < 0.33
      onBody = cord || sheet ? 1 : smooth((reach + 0.02 - radial) / 0.03)
      // nothing hangs from the ankles: boot edges and laces stay put
      ok = !rod && (cord || sheet || (!heldInFront && onBody > 0)) && hanging && p.topY > 0.2
      // a cape the hints mark as cloth hangs from its top seam whatever the shape rules say
      if (options.hints?.cloth?.length && (inCloth(top) || p.members.filter(inCloth).length * 2 > p.members.length)) {
        ok = true; cord = false; hair = false; onBody = 1
      }
      if (!ok) for (const m of p.members) kind[m] = 4
      if (options.debug && p.members.length > 30) debugInfo.push(JSON.stringify({ id: thins.pieceOf[p.members[0]], n: p.members.length, topY: +p.topY.toFixed(3), radial: +radial.toFixed(3), front: +front.toFixed(3), hanging, girth: +girth.toFixed(3), longest: +(longest / height).toFixed(3), cord, rod, heldInFront, sheet, x: +(((p.box[0] + p.box[3]) / 2 - ox) / height).toFixed(2), y: +((p.box[1] - minY) / height).toFixed(2), w: +((p.box[3] - p.box[0]) / height).toFixed(2), zs: +((p.box[5] - p.box[2]) / height).toFixed(2), straight: +principal(p.members, position).share.toFixed(3), meanRadial: +meanRadial.toFixed(3), onBody: +onBody.toFixed(2), ok }))
    }
    // a strap hanging from a pouch moves with the pouch
    accept.push({ cord, hair, reach: cord ? CORD_REACH : REACH, base: top >= 0 ? raw[top] : 0, onBody })
    if (!ok) { accept[accept.length - 1].reach = 0; continue }
    const topPos = position[top * 3 + 1]
    for (const a of p.seams) {
      seedsAny.push(a)
      if (position[a * 3 + 1] > topPos - 0.08 * height) seedsTop.push(a)
    }
  }
  const fromAny = walk(seedsAny, THIN), fromTop = walk(seedsTop, THIN)
  for (let i = 0; i < n; i++) {
    const id = thins.pieceOf[i]
    if (id < 0) continue
    const p = thins.list[id], a = accept[id]
    if (!a.reach) continue
    const hang = smooth((position[p.top * 3 + 1] - position[i * 3 + 1]) / (0.04 * height))
    const pin = a.base > 0 ? 1 : smooth(fromAny[i] / (PIN * height))
    const w = Math.min(1, a.base + smooth(fromTop[i] / (a.reach * height)) * pin * hang * a.onBody)
    if (!(w > 0.001)) continue
    raw[i] = w
    kind[i] = a.cord || a.hair ? 2 : 1
    strand[i] = a.hair ? STRAND_TYPE.hair : STRAND_TYPE.cord
    if (a.cord || a.hair) lively[i] = 1
  }

  // 8. cords inside rejected pieces: a rifle sling or a rope is fused into the weapon or the hand that holds
  // it. Their strands (thinner than STRAND_RADIUS) are split off and swing if they hang and are not straight.
  const rc = STRAND_RADIUS * CELLS_PER_HEIGHT
  const erodedC = new Uint8Array(N)
  for (let k = 0; k < N; k++) if (solid[k] && toOutside[k] > rc * rc) erodedC[k] = 1
  const toErodedC = distanceTransform(erodedC, 1, nx, ny, nz)
  const STRAND = 5
  for (let id = 0; id < thins.list.length; id++) {
    if (accept[id].reach) continue
    for (const m of thins.list[id].members) {
      const k = cellOf(position[m * 3], position[m * 3 + 1], position[m * 3 + 2])
      if (k >= 0 && toErodedC[k] > (rc + 1) * (rc + 1)) cls[m] = STRAND
    }
  }
  const strands = collect(STRAND, () => true)
  const strandArea = pieceAreas(strands.pieceOf, strands.list.length, index, triCount, weld, position)
  const strandSeeds: number[] = [], strandTop: number[] = []
  const strandOk: boolean[] = []
  for (const [id, p] of strands.list.entries()) {
    let ok = p.top >= 0 && p.members.length >= 12
    if (ok) {
      const topPos = position[p.top * 3 + 1]
      let cy = 0
      for (const m of p.members) cy += position[m * 3 + 1]
      cy /= p.members.length
      const tops = [...p.seams].filter((a) => position[a * 3 + 1] > topPos - 0.08 * height)
      const along = walk(tops, STRAND)
      let longest = 0
      for (const m of p.members) if (Number.isFinite(along[m])) longest = Math.max(longest, along[m])
      const girth = strandArea[id] / Math.max(longest, 1e-6) / height
      ok = topPos - cy > 0.3 * (p.box[4] - p.box[1]) && topPos - p.box[1] > 0.04 * height && longest > 0.05 * height
        && girth < 0.06 && !isRod(p.members, position, height) && p.topY > 0.2
        && Math.max(p.box[3] - p.box[0], p.box[5] - p.box[2]) < 0.25 * height
      if (options.debug) debugInfo.push('strand ' + JSON.stringify({ id, n: p.members.length, topY: +p.topY.toFixed(3), girth: +girth.toFixed(3), longest: +(longest / height).toFixed(3), hang: +((topPos - cy) / (p.box[4] - p.box[1])).toFixed(2), drop: +((topPos - p.box[1]) / height).toFixed(3), w: +((p.box[3] - p.box[0]) / height).toFixed(3), d: +((p.box[5] - p.box[2]) / height).toFixed(3), rod: isRod(p.members, position, height), ok }))
      if (ok) { for (const a of p.seams) strandSeeds.push(a); strandTop.push(...tops) }
    }
    strandOk.push(ok)
  }
  const strandAny = walk(strandSeeds, STRAND), strandFromTop = walk(strandTop, STRAND)
  for (let i = 0; i < n; i++) {
    const id = strands.pieceOf[i]
    if (id < 0 || !strandOk[id]) continue
    const p = strands.list[id]
    const hang = smooth((position[p.top * 3 + 1] - position[i * 3 + 1]) / (0.03 * height))
    const w = smooth(strandFromTop[i] / (CORD_REACH * height)) * smooth(strandAny[i] / (PIN * height)) * hang
    if (!(w > 0.001)) continue
    raw[i] = w; lively[i] = 1; kind[i] = 2; strand[i] = STRAND_TYPE.cord
  }

  // smooth over the mesh; body vertices stay exactly still, seam twins share one value
  let w = raw, live = lively
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(n), nextLive = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      // only inside the parts that swing: the body, hands and weapons around them keep exactly 0
      if (weld[i] !== i || kind[i] === 0 || kind[i] === 4) continue
      const list = neighbours[i]
      let s = w[i], l = live[i]
      for (const j of list) { s += w[j]; l += live[j] }
      next[i] = s / (list.length + 1); nextLive[i] = l / (list.length + 1)
    }
    w = next; live = nextLive
  }
  // 9. the model's hints: hair and antennas added, weapons held still, whole pieces swinging about a pivot
  const piece = new Int16Array(n).fill(-1)
  const parts = options.hints ? applyHints(options.hints, { n, weld, position, w, live, kind, strand, piece, minY, height, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 }) : null
  const weights = new Float32Array(n * 2)
  let moving = 0
  for (let i = 0; i < n; i++) {
    const v = w[weld[i]]
    weights[i * 2] = v < 0.002 ? 0 : v
    weights[i * 2 + 1] = v < 0.002 ? 0 : live[weld[i]]
    if (v >= 0.002 || (parts && parts[i * 4 + 3] > 0)) moving++
  }
  if (!moving && !options.debug) return null
  return {
    weights,
    parts: parts ?? undefined,
    pivotX: ox + (pivotX / Math.max(1, pivotN) + 0.5) * cell,
    pivotZ: oz + (pivotZ / Math.max(1, pivotN) + 0.5) * cell,
    minY, height, share: moving / n,
    kind: options.debug ? Uint8Array.from({ length: n }, (_, i) => kind[weld[i]]) : undefined,
    info: options.debug ? debugInfo : undefined,
    internals: options.internals
      ? { weld, neighbours, w, kind, strand, piece, core, grid: { ox, oy, oz, cell, nx, ny, nz }, minY, height, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 }
      : undefined,
  }
}

interface HintContext {
  n: number; weld: Int32Array; position: ArrayLike<number>
  /** Per welded vertex swing weight and liveliness (changed in place). */
  w: Float32Array; live: Float32Array; kind: Uint8Array
  /** STRAND_TYPE per welded vertex and the whole piece (hints.pieces index) it belongs to (changed in place). */
  strand: Uint8Array; piece: Int16Array
  minY: number; height: number; cx: number; cz: number
}

/** How far a point (fractions of height) is outside a box; 0 inside. */
function outside(box: HintBox, x: number, y: number, z: number) {
  const dx = Math.max(box[0] - x, 0, x - box[3]), dy = Math.max(box[1] - y, 0, y - box[4]), dz = Math.max(box[2] - z, 0, z - box[5])
  return Math.hypot(dx, dy, dz)
}

/**
 * Applies a model's hints to the swing weights (in place) and returns the whole-piece attribute
 * (pivot xyz + amount per vertex), or null when the model has no whole pieces.
 */
function applyHints(hints: BossSwayHints, c: HintContext): Float32Array | null {
  const { n, weld, position, w, live, kind, strand, piece, minY, height, cx, cz } = c
  const parts = hints.pieces?.length ? new Float32Array(n * 4) : null
  for (let i = 0; i < n; i++) {
    if (weld[i] !== i) continue
    const x = (position[i * 3] - cx) / height, y = (position[i * 3 + 1] - minY) / height, z = (position[i * 3 + 2] - cz) / height
    // hair: everything in the box hangs from its roots (the scalp line `root`) and swings like hair
    for (const hair of hints.hair ?? []) {
      const fade = 1 - smooth(outside(hair.box, x, y, z) / HINT_MARGIN)
      if (fade <= 0) continue
      // (around the head the hair is close to the body axis: only a little livelier, no flaring disc)
      const hang = smooth((hair.root - y) / (hair.reach ?? 0.07)) * fade * (hair.amount ?? 0.6)
      if (hang > w[i]) { w[i] = hang; live[i] = 0.3 * fade; kind[i] = 2; strand[i] = STRAND_TYPE.hair }
    }
    // antennas: fixed at the bottom of the box, bending more and more towards the tip
    for (const whip of hints.whips ?? []) {
      const [x0, y0, z0, x1, y1, z1] = whip.box
      if (x < x0 || x > x1 || z < z0 || z > z1 || y < y0 || y > y1) continue
      const t = (y - y0) / Math.max(1e-6, y1 - y0)
      const bend = t * t * (whip.amount ?? 0.6)
      if (bend > w[i]) { w[i] = bend; live[i] = 1; kind[i] = 2; strand[i] = STRAND_TYPE.antenna }
    }
    for (const soft of hints.soften ?? []) {
      const fade = 1 - smooth(outside(soft.box, x, y, z) / HINT_MARGIN)
      if (fade > 0) w[i] *= 1 - fade * (1 - soft.factor)
    }
    // weapons: still, fading back in just outside the box
    let hold = 1
    for (const box of hints.rigid ?? []) hold = Math.min(hold, smooth(outside(box, x, y, z) / HINT_MARGIN))
    if (hold < 1) { w[i] *= hold; if (hold === 0) kind[i] = 4 }
    // whole pieces: the piece turns about its pivot as one; its own cloth motion is replaced by that
    if (parts) hints.pieces!.forEach((hint, index) => {
      const d = outside(hint.box, x, y, z)
      if (d >= PIECE_MARGIN) return
      const fade = 1 - smooth(d / PIECE_MARGIN)
      const b = hint.box
      const pivot = hint.pivot ?? [(b[0] + b[3]) / 2, b[4], (b[2] + b[5]) / 2]
      const amount = fade * (hint.amount ?? 1) * hold
      if (amount <= parts[i * 4 + 3]) return
      parts[i * 4] = pivot[0] * height + cx; parts[i * 4 + 1] = pivot[1] * height + minY; parts[i * 4 + 2] = pivot[2] * height + cz
      parts[i * 4 + 3] = amount
      w[i] *= 1 - fade
      kind[i] = 5
      piece[i] = index
    })
  }
  if (!parts) return null
  // seam twins share their first vertex's values
  for (let i = 0; i < n; i++) if (weld[i] !== i) parts.copyWithin(i * 4, weld[i] * 4, weld[i] * 4 + 4)
  return parts
}

/** Surface area of each piece (triangles whose corners all belong to it). */
function pieceAreas(pieceOf: Int32Array, count: number, index: ArrayLike<number> | null, triCount: number, weld: Int32Array, position: ArrayLike<number>): Float64Array {
  const areas = new Float64Array(count)
  for (let t = 0; t < triCount; t++) {
    const a = weld[index ? index[t * 3] : t * 3], b = weld[index ? index[t * 3 + 1] : t * 3 + 1], c = weld[index ? index[t * 3 + 2] : t * 3 + 2]
    const id = pieceOf[a]
    if (id < 0 || pieceOf[b] !== id || pieceOf[c] !== id) continue
    const ux = position[b * 3] - position[a * 3], uy = position[b * 3 + 1] - position[a * 3 + 1], uz = position[b * 3 + 2] - position[a * 3 + 2]
    const vx = position[c * 3] - position[a * 3], vy = position[c * 3 + 1] - position[a * 3 + 1], vz = position[c * 3 + 2] - position[a * 3 + 2]
    areas[id] += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
  }
  return areas
}

/** A long, straight loose piece (a barrel, a handle, a blade): its principal axis carries nearly all of its spread. */
function isRod(members: number[], position: ArrayLike<number>, height: number): boolean {
  const { share, length } = principal(members, position)
  return share > 0.97 && length > 0.06 * height
}

/** Share of the spread along the principal axis, and the piece's length along it. */
function principal(members: number[], position: ArrayLike<number>): { share: number; length: number } {
  let mx = 0, my = 0, mz = 0
  for (const i of members) { mx += position[i * 3]; my += position[i * 3 + 1]; mz += position[i * 3 + 2] }
  mx /= members.length; my /= members.length; mz /= members.length
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0
  for (const i of members) {
    const x = position[i * 3] - mx, y = position[i * 3 + 1] - my, z = position[i * 3 + 2] - mz
    xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z
  }
  // principal axis by power iteration
  let ax = 0.3, ay = 1, az = 0.2
  for (let it = 0; it < 24; it++) {
    const nx = xx * ax + xy * ay + xz * az, ny = xy * ax + yy * ay + yz * az, nz = xz * ax + yz * ay + zz * az
    const l = Math.hypot(nx, ny, nz) || 1
    ax = nx / l; ay = ny / l; az = nz / l
  }
  const total = xx + yy + zz
  const major = xx * ax * ax + yy * ay * ay + zz * az * az + 2 * (xy * ax * ay + xz * ax * az + yz * ay * az)
  const length = Math.sqrt(major / members.length) * 3.4
  return { share: total > 0 ? major / total : 1, length }
}

/**
 * Squared Euclidean distance (in voxels) from every voxel to the nearest voxel whose mask equals `target`
 * (Felzenszwalb–Huttenlocher, separable in x, y, z).
 */
export function distanceTransform(mask: Uint8Array, target: 0 | 1, nx: number, ny: number, nz: number): Float32Array {
  const INF = 1e20
  const out = new Float32Array(mask.length)
  for (let k = 0; k < mask.length; k++) out[k] = mask[k] === target ? 0 : INF
  const size = Math.max(nx, ny, nz)
  const f = new Float64Array(size), d = new Float64Array(size), z = new Float64Array(size + 1)
  const v = new Int32Array(size)
  const pass = (count: number, stride: number, start: number) => {
    for (let q = 0; q < count; q++) f[q] = out[start + q * stride]
    let k = 0
    v[0] = 0; z[0] = -INF; z[1] = INF
    for (let q = 1; q < count; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]) }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < count; q++) {
      while (z[k + 1] < q) k++
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
    }
    for (let q = 0; q < count; q++) out[start + q * stride] = d[q]
  }
  const sy = nx, sz = nx * ny
  for (let zz = 0; zz < nz; zz++) for (let yy = 0; yy < ny; yy++) pass(nx, 1, yy * sy + zz * sz)
  for (let zz = 0; zz < nz; zz++) for (let xx = 0; xx < nx; xx++) pass(ny, sy, xx + zz * sz)
  for (let yy = 0; yy < ny; yy++) for (let xx = 0; xx < nx; xx++) pass(nz, sz, xx + yy * sy)
  return out
}

export class MinHeap {
  private keys: number[] = []
  private values: number[] = []
  get size() { return this.keys.length }
  push(key: number, value: number) {
    const keys = this.keys, values = this.values
    let c = keys.length
    keys.push(key); values.push(value)
    while (c > 0) {
      const p = (c - 1) >> 1
      if (keys[p] <= key) break
      keys[c] = keys[p]; values[c] = values[p]; c = p
    }
    keys[c] = key; values[c] = value
  }
  pop(): number {
    const keys = this.keys, values = this.values
    const top = values[0]
    const lastKey = keys.pop()!, lastValue = values.pop()!
    const count = keys.length
    if (count) {
      let c = 0
      for (;;) {
        const l = c * 2 + 1, r = l + 1
        let m = -1, mk = lastKey
        if (l < count && keys[l] < mk) { m = l; mk = keys[l] }
        if (r < count && keys[r] < mk) m = r
        if (m < 0) break
        keys[c] = keys[m]; values[c] = values[m]; c = m
      }
      keys[c] = lastKey; values[c] = lastValue
    }
    return top
  }
}

