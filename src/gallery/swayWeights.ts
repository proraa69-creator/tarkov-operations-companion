/**
 * Finds the loose, hanging parts of a boss model — cloth flaps, coat and jacket hems, hoods, straps, cords,
 * dreadlocks — and gives every vertex a swing weight for the Gallery's cloth motion (swayMaterial.ts).
 *
 * The Tripo exports are one fused mesh with no skeleton, so parts are told apart by shape:
 * 1. on a voxel grid the surface is rasterised and the inside filled (flood fill of the outside);
 * 2. a morphological opening of that solid with a ball of radius CORE_RADIUS keeps everything at least that
 *    thick — torso, head, arms, legs, boots, pouches, weapon bodies — as the rigid core; vertices outside it
 *    are loose (sheets, straps, cords, strands);
 * 3. on the mesh, connected loose vertices form pieces; a piece hangs from its highest seam with the core.
 *    Its weight grows with the distance along the surface from that seam (0 at the seam → 1 over REACH) and
 *    drops back to 0 near every other seam (PIN), so nothing tears off or stretches where it is fused;
 * 4. only pieces hanging from the torso/hips/head column swing: straight rods (barrels, handles, blades),
 *    anything bulky or high in front of the chest (weapons in the hands) and parts above their seam stay rigid.
 * Coincident vertices (UV seams) always get the same weight, so the surface never cracks open.
 * Runs once per model, off the main thread (swayWeights.worker.ts): 0.1–0.6 s for a 30k-vertex model.
 */
const CELLS_PER_HEIGHT = 150
/** Parts thinner than this (radius, fraction of the model height) count as loose. */
const CORE_RADIUS = 0.02
/** Distance along a loose part (fraction of height) over which its weight rises from 0 to 1. */
const REACH = 0.18
/** Any other place a loose part is fused to the body pins it: the weight is back to 0 within this distance. */
const PIN = 0.04
/** A loose part swings only if it is attached within this distance of the body's vertical axis (fraction of height). */
const ATTACH_RADIUS = 0.12
/** Attachments above this height (fraction) are head/hair: lighter and livelier. */
const HEAD_HEIGHT = 0.82

export interface SwayWeights {
  /** Per vertex: x = swing weight 0..1, y = 1 on hair/head cloth. */
  weights: Float32Array
  /** Body axis (model space) the swing turns around. */
  pivotX: number
  pivotZ: number
  minY: number
  height: number
  /** Share of vertices that move at all (for diagnostics). */
  share: number
}

const smooth = (t: number) => { const c = t < 0 ? 0 : t > 1 ? 1 : t; return c * c * (3 - 2 * c) }

export function computeSwayWeights(position: ArrayLike<number>, index: ArrayLike<number> | null, coreRadius = CORE_RADIUS): SwayWeights | null {
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
  const loose = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (weld[i] !== i) continue
    const k = cellOf(position[i * 3], position[i * 3 + 1], position[i * 3 + 2])
    if (k >= 0 && solid[k] && !core[k]) loose[i] = 1
  }

  // 5. loose pieces (connected loose vertices) and the rigid vertices each one is fused to
  const piece = new Int32Array(n).fill(-1)
  const pieces: { rigid: boolean; top: number }[] = []
  const seedsAny: number[] = [], seedsTop: number[] = []
  for (let i = 0; i < n; i++) {
    if (!loose[i] || piece[i] >= 0) continue
    const id = pieces.length
    const members = [i]
    const seams = new Set<number>()
    piece[i] = id
    for (let m = 0; m < members.length; m++) for (const j of neighbours[members[m]]) {
      if (loose[j]) { if (piece[j] < 0) { piece[j] = id; members.push(j) } } else seams.add(j)
    }
    // it hangs from its highest seam (a cape from the shoulders). Rigid things, not cloth: straight rods
    // (barrels, handles, a blade; hanging hair strands may be straight) and anything hanging in front of
    // the chest or bulky in depth there — that is where the hands hold weapons; loincloths and tabards
    // start at the belt and are flat.
    let top = -1
    for (const a of seams) if (top < 0 || position[a * 3 + 1] > position[top * 3 + 1]) top = a
    let rigid = top < 0 || members.length < 12
    if (!rigid) {
      const topY = (position[top * 3 + 1] - minY) / height
      const layer = Math.max(0, Math.min(ny - 1, Math.floor((position[top * 3 + 1] - oy) / cell)))
      const front = (position[top * 3 + 2] - oz) / cell - 0.5 - layerZ[layer]
      let zMin = Infinity, zMax = -Infinity
      for (const m of members) { zMin = Math.min(zMin, position[m * 3 + 2]); zMax = Math.max(zMax, position[m * 3 + 2]) }
      const heldInFront = front * cell > 0.03 * height && (topY > 0.58 || zMax - zMin > 0.05 * height)
      rigid = heldInFront || (topY < HEAD_HEIGHT && isRod(members, position, height))
    }
    pieces.push({ rigid, top })
    if (rigid) continue
    for (const a of seams) {
      seedsAny.push(a)
      if (position[a * 3 + 1] > position[top * 3 + 1] - 0.08 * height) seedsTop.push(a)
    }
  }
  // distance along the surface from any seam (the part is pinned there) and from its top seam (it hangs from there)
  const edge = (a: number, b: number) => Math.hypot(position[a * 3] - position[b * 3], position[a * 3 + 1] - position[b * 3 + 1], position[a * 3 + 2] - position[b * 3 + 2])
  const walk = (seeds: number[]) => {
    const dist = new Float32Array(n).fill(Infinity)
    const heap = new MinHeap()
    for (const a of seeds) if (dist[a] !== 0) { dist[a] = 0; heap.push(0, a) }
    while (heap.size) {
      const i = heap.pop()
      for (const j of neighbours[i]) {
        if (!loose[j]) continue
        const d = dist[i] + edge(i, j)
        if (d < dist[j] - 1e-9) { dist[j] = d; heap.push(d, j) }
      }
    }
    return dist
  }
  const fromAny = walk(seedsAny), fromTop = walk(seedsTop)

  const raw = new Float32Array(n), hair = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (!loose[i]) continue
    const p = pieces[piece[i]]
    if (p.rigid) continue
    const a = p.top
    const attachY = position[a * 3 + 1], vy = position[i * 3 + 1]
    const layer = Math.max(0, Math.min(ny - 1, Math.floor((attachY - oy) / cell)))
    const radial = Math.hypot((position[a * 3] - ox) / cell - 0.5 - layerX[layer], (position[a * 3 + 2] - oz) / cell - 0.5 - layerZ[layer]) * cell / height
    // hanging from the torso/hips/head column, wider behind the shoulders where capes, hoods and hair start
    // (in front of the shoulders the hands hold things)
    const behind = smooth((layerZ[layer] - ((position[a * 3 + 2] - oz) / cell - 0.5)) * cell / (0.03 * height))
    const reach = ATTACH_RADIUS + smooth(((attachY - minY) / height - 0.62) / 0.12) * behind * 0.1
    const onBody = smooth((reach + 0.02 - radial) / 0.03)
    const hang = smooth((attachY - vy) / (0.04 * height))
    const w = smooth(fromTop[i] / (REACH * height)) * smooth(fromAny[i] / (PIN * height)) * hang * onBody
    if (!(w > 0.001)) continue
    raw[i] = w
    if ((attachY - minY) / height > HEAD_HEIGHT) hair[i] = 1
  }

  // smooth over the mesh; rigid vertices stay exactly still, seam twins share one value
  let w = raw
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      if (weld[i] !== i || !loose[i]) continue
      const list = neighbours[i]
      let s = w[i]
      for (const j of list) s += w[j]
      next[i] = s / (list.length + 1)
    }
    w = next
  }
  const weights = new Float32Array(n * 2)
  let moving = 0
  for (let i = 0; i < n; i++) {
    const v = w[weld[i]]
    weights[i * 2] = v < 0.002 ? 0 : v
    weights[i * 2 + 1] = hair[weld[i]]
    if (v >= 0.002) moving++
  }
  if (!moving) return null
  return {
    weights,
    pivotX: ox + (pivotX / Math.max(1, pivotN) + 0.5) * cell,
    pivotZ: oz + (pivotZ / Math.max(1, pivotN) + 0.5) * cell,
    minY, height, share: moving / n,
  }
}

/** A long, straight loose piece (a barrel, a handle, a blade): its principal axis carries nearly all of its spread. */
function isRod(members: number[], position: ArrayLike<number>, height: number): boolean {
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
  return major > total * 0.97 && length > 0.06 * height
}

/**
 * Squared Euclidean distance (in voxels) from every voxel to the nearest voxel whose mask equals `target`
 * (Felzenszwalb–Huttenlocher, separable in x, y, z).
 */
function distanceTransform(mask: Uint8Array, target: 0 | 1, nx: number, ny: number, nz: number): Float32Array {
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

class MinHeap {
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

