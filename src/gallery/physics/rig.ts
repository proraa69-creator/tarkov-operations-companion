/**
 * The physics rig of a boss model: what moves, where it is attached, what it collides with and how the mesh follows.
 * Built once per model off the main thread (rig.worker.ts) from the shape analysis (swayWeights.ts `internals`). The
 * Tripo exports are one fused mesh with no skeleton and no animations, so the rig is made from the geometry itself:
 *
 * - Particles: the loose vertices — cloth (capes, cloaks, coat hems, tabards), straps and cords (slings, ropes), hair
 *   and dreads, antennas — grouped per element on a grid of the element's particle spacing. Both faces of a sheet
 *   fall into one particle, so a cape never opens up. A particle is pinned (it follows the body) where its element is
 *   fused to the body: the top of a cape, hair roots, antenna bases, both ends of a sling.
 * - Links: stretch links between particles whose vertices share a mesh edge. A particle and its linked neighbours
 *   form a region whose sculpted shape the simulation keeps (local shape matching: bending stiffness).
 * - Tethers: every free particle stays within its rest distance along the element from its nearest pin (plus the
 *   material's stretch limit), so nothing stretches out however hard the model is turned.
 * - Hang directions: from every particle towards its attachment; a part hanging below its attachment is pulled back
 *   like a pendulum of its length along the element (physics/sim.ts).
 * - Pieces: whole rigid pieces swinging about a pivot: the hint pieces (holsters, backpacks, hoods) and the pouches
 *   the analysis found on the torso, hips and thighs.
 * - Collider: a signed distance field of the rigid body (torso, head, limbs, weapons: the analysis's core) on the
 *   analysis's voxel grid (1/150 of the height).
 * - Skin weights: every vertex follows the body and up to three particles, or the body and one piece. The body, head,
 *   arms, legs, weapons and rigid armour follow the body alone (bone 0, always the identity): they never move.
 *
 * The simulation frame is mesh space shifted to the centre of the feet and scaled to a figure 1.8 m tall, so the
 * material settings (config.ts) are in real-world units. The rig is plain typed arrays (transferable).
 */
import type { BossSwayHints } from '../bossSwayHints'
import { KIND, MinHeap, STRAND_TYPE, computeSwayWeights, distanceTransform, type SwayInternals } from '../swayWeights'
import { PARTICLE_KINDS, PHYSICS_SETTINGS, particleProfile, type PhysicsOverrides } from './config'

/** Element of a particle: index into PARTICLE_KINDS. */
export const ELEMENT = { cloth: 0, strap: 1, hair: 2, antenna: 3 } as const
/** Kind of a piece: index into PIECE_KINDS. */
export const PIECE = { pouch: 0, gear: 1 } as const

/** Vertices that swing less than this stay on the body. */
const MIN_WEIGHT = 0.003
/** A particle whose vertices swing less than this on average is an attachment: it follows the body. */
const PIN_MOBILITY = 0.04
/**
 * A particle touching vertices that stay on the body (the element is fused there) is pinned up to this mobility: half
 * attached, it would hold back its free neighbours (the links stretch) and still tear the fused seam when it moves.
 */
const ATTACHED_PIN = 0.35
/** Vertices follow their particles fully from this swing weight on (below, they blend with the body). */
const FULL_WEIGHT = 0.1
/** Parts of one grid cell closer than this (× spacing) are one particle: both faces of a sheet, strands of a lock. */
const MERGE = 0.6
/** More particles than this: the grid is coarsened. */
const MAX_PARTICLES = 1600
/** Pieces larger than this (m) swing like gear, smaller ones like pouches. */
const GEAR_SIZE = 0.13
/** Pieces and pouches with fewer vertices stay on the body. */
const MIN_PIECE = 12
/** Pouch vertices follow the pouch fully from this share of its largest weight on (the top seam has weight 0). */
const POUCH_FULL = 0.35
/** Hair hangs at most this far (m); a longer "hair" element is a cape. */
const HAIR_LENGTH = 0.45

export type Vec3 = [number, number, number]

export interface PhysicsRig {
  /** Metres per mesh unit; the mesh point at the origin of the simulation frame (centre of the feet). */
  scale: number
  origin: Vec3
  /** Mesh-space up in the viewer's rest pose: the model was sculpted hanging under the opposite gravity. */
  up: Vec3
  particles: number
  /** Rest positions, m (3 per particle). */
  rest: Float32Array
  /** ELEMENT per particle. */
  type: Uint8Array
  /** Mean swing weight of the particle's vertices: 0 = fused to the body, 1 = free. */
  mobility: Float32Array
  pinned: Uint8Array
  /** Unit vector from the particle towards its attachment, along the element (3 per particle). */
  hang: Float32Array
  /** Nearest pin along the element (-1 for pins) and the rest distance to it along the element, m. */
  tether: Int32Array
  tetherLength: Float32Array
  /** Signed distance to the body at rest, m (negative inside: a cape lying on the back). */
  restDistance: Float32Array
  /** Stretch links: particle pairs whose vertices share a mesh edge. */
  links: Int32Array
  /** Rest length, m. */
  linkRest: Float32Array
  /** ELEMENT whose material the link uses (the softer one where elements meet). */
  linkType: Uint8Array
  /** Linked neighbours (CSR): neighbours[neighbourStart[i] .. neighbourStart[i + 1]). A particle and its neighbours are
   * the region whose sculpted shape the simulation keeps (bending stiffness). */
  neighbourStart: Int32Array
  neighbours: Int32Array
  pieces: number
  /** PIECE per piece. */
  pieceType: Uint8Array
  /** Pivot and centre, m (3 each); outward: horizontal unit vector away from the body. */
  pivot: Float32Array
  centroid: Float32Array
  outward: Float32Array
  /** Radius of gyration about the centre, m. */
  pieceRadius: Float32Array
  /** Swing scale 0..1 (hint `amount`). */
  pieceAmount: Float32Array
  /** Per vertex: 4 bone indices and weights. Bone 0 = the body, then the particles, then the pieces. */
  skinIndex: Uint16Array
  skinWeight: Float32Array
  /** Body collider: signed distance to the rigid body, m, on a grid in the simulation frame (x fastest). */
  sdf: Float32Array
  sdfOrigin: Vec3
  sdfCell: number
  sdfSize: Vec3
  info: string[]
}

export interface RigInput {
  /** Per vertex: pivot (x, y, z, mesh space) and share of the whole piece it belongs to (SwayWeights.parts). */
  parts?: Float32Array
  hints?: BossSwayHints
  overrides?: PhysicsOverrides
  /** Mesh-space up in the viewer's rest pose (default +y). */
  up?: readonly [number, number, number]
}

const smooth = (t: number) => { const c = t < 0 ? 0 : t > 1 ? 1 : t; return c * c * (3 - 2 * c) }

export function buildPhysicsRig(position: ArrayLike<number>, sway: SwayInternals, input: RigInput = {}): PhysicsRig {
  const n = sway.weld.length
  const scale = PHYSICS_SETTINGS.bodyHeight / sway.height
  const origin: Vec3 = [sway.cx, sway.minY, sway.cz]
  const upLength = Math.hypot(...(input.up ?? [0, 1, 0])) || 1
  const up: Vec3 = input.up ? [input.up[0] / upLength, input.up[1] / upLength, input.up[2] / upLength] : [0, 1, 0]
  const profiles = PARTICLE_KINDS.map((kind) => particleProfile(kind, input.overrides))
  const at = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) at[i * 3 + c] = (position[i * 3 + c] - origin[c]) * scale

  // 1. loose vertices (welded) and their element
  const element = new Int8Array(n).fill(-1)
  const loose: number[] = []
  for (let v = 0; v < n; v++) {
    if (sway.weld[v] !== v || !(sway.w[v] > MIN_WEIGHT)) continue
    if (sway.kind[v] === KIND.cloth) element[v] = ELEMENT.cloth
    else if (sway.kind[v] === KIND.strand) {
      element[v] = sway.strand[v] === STRAND_TYPE.hair ? ELEMENT.hair : sway.strand[v] === STRAND_TYPE.antenna ? ELEMENT.antenna : ELEMENT.strap
    } else continue
    loose.push(v)
  }
  // a "hair" element longer than any hair is a cape fused high at the neck: cloth
  {
    const seen = new Uint8Array(n)
    for (const v of loose) {
      if (element[v] !== ELEMENT.hair || seen[v]) continue
      const members = [v]
      seen[v] = 1
      let low = Infinity, high = -Infinity
      for (let m = 0; m < members.length; m++) {
        const u = members[m]
        low = Math.min(low, at[u * 3 + 1]); high = Math.max(high, at[u * 3 + 1])
        for (const k of sway.neighbours[u]) if (element[k] === ELEMENT.hair && !seen[k]) { seen[k] = 1; members.push(k) }
      }
      if (high - low > HAIR_LENGTH) for (const u of members) element[u] = ELEMENT.cloth
    }
  }

  // 2. particles: grid cells per element, split where the cell holds unconnected parts far apart
  const cluster = (coarse: number) => {
    const cells = new Map<string, number[]>()
    for (const v of loose) {
      const s = profiles[element[v]].spacing * coarse
      const key = `${element[v]} ${Math.floor(at[v * 3] / s)} ${Math.floor(at[v * 3 + 1] / s)} ${Math.floor(at[v * 3 + 2] / s)}`
      const list = cells.get(key)
      if (list) list.push(v); else cells.set(key, [v])
    }
    const particleOf = new Int32Array(n).fill(-1)
    const cellOf = new Int32Array(n).fill(-1)
    const seen = new Int32Array(n).fill(-1)
    const groups: number[][] = []
    let id = 0
    for (const list of cells.values()) {
      id++
      for (const v of list) cellOf[v] = id
      const parts: number[][] = []
      for (const v of list) {
        if (seen[v] === id) continue
        seen[v] = id
        const members = [v]
        for (let m = 0; m < members.length; m++) {
          for (const u of sway.neighbours[members[m]]) if (cellOf[u] === id && seen[u] !== id) { seen[u] = id; members.push(u) }
        }
        parts.push(members)
      }
      for (const members of mergeClose(parts, at, MERGE * profiles[element[list[0]]].spacing * coarse)) {
        for (const m of members) particleOf[m] = groups.length
        groups.push(members)
      }
    }
    return { groups, particleOf, coarse }
  }
  let clusters = cluster(1)
  while (clusters.groups.length > MAX_PARTICLES && clusters.coarse < 4) clusters = cluster(clusters.coarse * 1.25)
  const { groups, particleOf } = clusters
  const N = groups.length
  const rest = new Float32Array(N * 3), type = new Uint8Array(N), mobility = new Float32Array(N)
  groups.forEach((members, p) => {
    let x = 0, y = 0, z = 0, w = 0
    for (const v of members) { x += at[v * 3]; y += at[v * 3 + 1]; z += at[v * 3 + 2]; w += sway.w[v] }
    rest[p * 3] = x / members.length; rest[p * 3 + 1] = y / members.length; rest[p * 3 + 2] = z / members.length
    mobility[p] = Math.min(1, w / members.length)
    type[p] = element[members[0]]
  })
  const gap = (a: number, b: number) => Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2])

  // 3. links along mesh edges; particles touching vertices that stay on the body are attachments
  const linkIndex = new Map<number, number>()
  const pairs: number[] = [], linkTypes: number[] = []
  const addLink = (a: number, b: number, kind: number) => {
    const lo = Math.min(a, b), hi = Math.max(a, b), key = lo * N + hi
    if (lo === hi || linkIndex.has(key)) return
    linkIndex.set(key, linkTypes.length)
    pairs.push(lo, hi)
    linkTypes.push(kind)
  }
  const softer = (a: number, b: number) => (profiles[type[a]].stretchHz <= profiles[type[b]].stretchHz ? type[a] : type[b])
  const attached = new Uint8Array(N)
  for (const v of loose) {
    const a = particleOf[v]
    for (const u of sway.neighbours[v]) {
      const b = particleOf[u]
      if (b < 0) attached[a] = 1
      else if (b !== a) addLink(a, b, softer(a, b))
    }
  }
  const neighbourStart = new Int32Array(N + 1)
  for (let l = 0; l < linkTypes.length; l++) { neighbourStart[pairs[l * 2] + 1]++; neighbourStart[pairs[l * 2 + 1] + 1]++ }
  for (let p = 0; p < N; p++) neighbourStart[p + 1] += neighbourStart[p]
  const neighbours = new Int32Array(neighbourStart[N])
  {
    const fill = neighbourStart.slice(0, N)
    for (let l = 0; l < linkTypes.length; l++) {
      const a = pairs[l * 2], b = pairs[l * 2 + 1]
      neighbours[fill[a]++] = b
      neighbours[fill[b]++] = a
    }
  }

  // 4. pins: where the element is fused to the body (barely mobile, or touching the body and not very mobile); an
  // element with none is pinned at its stillest attachment
  const pinned = new Uint8Array(N)
  for (let p = 0; p < N; p++) if (mobility[p] < PIN_MOBILITY || (attached[p] && mobility[p] < ATTACHED_PIN)) pinned[p] = 1
  {
    const component = new Int32Array(N).fill(-1)
    for (let p = 0; p < N; p++) {
      if (component[p] >= 0) continue
      const members = [p]
      component[p] = p
      for (let m = 0; m < members.length; m++) {
        const a = members[m]
        for (let k = neighbourStart[a]; k < neighbourStart[a + 1]; k++) {
          const b = neighbours[k]
          if (component[b] < 0) { component[b] = p; members.push(b) }
        }
      }
      if (members.some((q) => pinned[q])) continue
      let best = members[0]
      for (const q of members) {
        if (attached[q] > attached[best] || (attached[q] === attached[best] && mobility[q] < mobility[best])) best = q
      }
      pinned[best] = 1
    }
  }

  // 5. along the elements from the pins: nearest pin (tether), rest distance to it, the way to it (hang direction)
  const along = new Float64Array(N).fill(Infinity)
  const nearest = new Int32Array(N).fill(-1), parent = new Int32Array(N).fill(-1)
  const heap = new MinHeap()
  for (let p = 0; p < N; p++) if (pinned[p]) { along[p] = 0; nearest[p] = p; heap.push(0, p) }
  while (heap.size) {
    const a = heap.pop()
    for (let k = neighbourStart[a]; k < neighbourStart[a + 1]; k++) {
      const b = neighbours[k], d = along[a] + gap(a, b)
      if (d < along[b] - 1e-9) { along[b] = d; nearest[b] = nearest[a]; parent[b] = a; heap.push(d, b) }
    }
  }
  const tether = new Int32Array(N).fill(-1), tetherLength = new Float32Array(N), hang = new Float32Array(N * 3)
  for (let p = 0; p < N; p++) {
    if (pinned[p] || nearest[p] < 0) continue
    tether[p] = nearest[p]
    tetherLength[p] = along[p]
    // two steps towards the attachment: smooth over the grid, still following the element round a shoulder
    let anchor = parent[p]
    if (parent[anchor] >= 0) anchor = parent[anchor]
    const dx = rest[anchor * 3] - rest[p * 3], dy = rest[anchor * 3 + 1] - rest[p * 3 + 1], dz = rest[anchor * 3 + 2] - rest[p * 3 + 2]
    const length = Math.hypot(dx, dy, dz)
    if (length > 1e-9) { hang[p * 3] = dx / length; hang[p * 3 + 1] = dy / length; hang[p * 3 + 2] = dz / length } else hang.set(up, p * 3)
  }

  const L = linkTypes.length
  const links = Int32Array.from(pairs), linkRest = new Float32Array(L), linkType = Uint8Array.from(linkTypes)
  for (let l = 0; l < L; l++) linkRest[l] = gap(links[l * 2], links[l * 2 + 1])

  // 6. the body collider: signed distance to the core (torso, head, limbs, weapons) on the analysis's voxel grid
  const { ox, oy, oz, cell, nx, ny, nz } = sway.grid
  const toBody = distanceTransform(sway.core, 1, nx, ny, nz)
  const toAir = distanceTransform(sway.core, 0, nx, ny, nz)
  const sdf = new Float32Array(nx * ny * nz)
  const unit = cell * scale
  for (let k = 0; k < sdf.length; k++) {
    // voxel centres: the surface lies half a voxel out from the last body voxel
    const d = sway.core[k] ? 0.5 - Math.sqrt(toAir[k]) : Math.sqrt(toBody[k]) - 0.5
    sdf[k] = Number.isFinite(d) ? Math.min(1, d * unit) : 1
  }
  const field = {
    sdf, sdfCell: unit, sdfSize: [nx, ny, nz] as Vec3,
    sdfOrigin: [(ox + cell / 2 - origin[0]) * scale, (oy + cell / 2 - origin[1]) * scale, (oz + cell / 2 - origin[2]) * scale] as Vec3,
  }
  const restDistance = new Float32Array(N)
  for (let p = 0; p < N; p++) restDistance[p] = sampleSdf(field, rest[p * 3], rest[p * 3 + 1], rest[p * 3 + 2])

  // 7. pieces: hint pieces (whole holsters, backpacks, hoods) and the pouches of the analysis
  /** `full`: the weight from which a vertex follows the piece fully; `fromParts`: weights are SwayWeights.parts shares. */
  interface PieceBuild { members: number[]; pivot: Vec3; type: number; amount: number; full: number; fromParts: boolean }
  const built: PieceBuild[] = []
  const extentOf = (members: number[]) => {
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
    for (const v of members) for (let c = 0; c < 3; c++) { box[c] = Math.min(box[c], at[v * 3 + c]); box[c + 3] = Math.max(box[c + 3], at[v * 3 + c]) }
    return box
  }
  if (input.parts) {
    const byPiece = new Map<string, number[]>()
    for (let v = 0; v < n; v++) {
      if (sway.weld[v] !== v || !(input.parts[v * 4 + 3] > MIN_WEIGHT)) continue
      const key = sway.piece[v] >= 0 ? `h${sway.piece[v]}` : `p${input.parts[v * 4].toFixed(4)} ${input.parts[v * 4 + 1].toFixed(4)} ${input.parts[v * 4 + 2].toFixed(4)}`
      const list = byPiece.get(key)
      if (list) list.push(v); else byPiece.set(key, [v])
    }
    for (const members of byPiece.values()) {
      if (members.length < MIN_PIECE) continue
      const v = members[0]
      const pivot: Vec3 = [0, 1, 2].map((c) => (input.parts![v * 4 + c] - origin[c]) * scale) as Vec3
      let full = 0
      for (const m of members) full = Math.max(full, input.parts[m * 4 + 3])
      const box = extentOf(members)
      const size = Math.max(box[3] - box[0], box[4] - box[1], box[5] - box[2])
      built.push({ members, pivot, type: size > GEAR_SIZE ? PIECE.gear : PIECE.pouch, amount: Math.min(1, full), full: full * 0.8, fromParts: true })
    }
  }
  {
    const seen = new Uint8Array(n)
    for (let v = 0; v < n; v++) {
      if (sway.weld[v] !== v || sway.kind[v] !== KIND.pouch || seen[v]) continue
      const members = [v]
      seen[v] = 1
      for (let m = 0; m < members.length; m++) for (const u of sway.neighbours[members[m]]) if (sway.kind[u] === KIND.pouch && !seen[u]) { seen[u] = 1; members.push(u) }
      let full = 0
      for (const m of members) full = Math.max(full, sway.w[m])
      if (members.length < MIN_PIECE || !(full > MIN_WEIGHT)) continue
      // pivot: the middle of the top seam
      const box = extentOf(members)
      const band = box[4] - (box[4] - box[1]) * 0.25
      const pivot: Vec3 = [0, 0, 0]
      let count = 0
      for (const m of members) if (at[m * 3 + 1] >= band) { pivot[0] += at[m * 3]; pivot[1] += at[m * 3 + 1]; pivot[2] += at[m * 3 + 2]; count++ }
      for (let c = 0; c < 3; c++) pivot[c] /= Math.max(1, count)
      built.push({ members, pivot, type: PIECE.pouch, amount: 1, full: full * POUCH_FULL, fromParts: false })
    }
  }
  const P = built.length
  const pieceType = new Uint8Array(P), pivot = new Float32Array(P * 3), centroid = new Float32Array(P * 3)
  const outward = new Float32Array(P * 3), pieceRadius = new Float32Array(P), pieceAmount = new Float32Array(P)
  built.forEach((piece, j) => {
    const c: Vec3 = [0, 0, 0]
    for (const v of piece.members) for (let k = 0; k < 3; k++) c[k] += at[v * 3 + k] / piece.members.length
    let spread = 0
    for (const v of piece.members) spread += (at[v * 3] - c[0]) ** 2 + (at[v * 3 + 1] - c[1]) ** 2 + (at[v * 3 + 2] - c[2]) ** 2
    pieceType[j] = piece.type
    pivot.set(piece.pivot, j * 3)
    centroid.set(c, j * 3)
    pieceRadius[j] = Math.sqrt(spread / piece.members.length)
    pieceAmount[j] = piece.amount
    // away from the body axis at the pivot's height
    const axis = bodyAxis(field, piece.pivot[1])
    const ax = c[0] - axis[0], az = c[2] - axis[1], length = Math.hypot(ax, az)
    outward.set(length > 1e-6 ? [ax / length, 0, az / length] : [0, 0, -1], j * 3)
  })

  // 8. skin weights: bone 0 = body, 1 + particle, 1 + N + piece
  const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4)
  const pieceOf = new Int32Array(n).fill(-1)
  built.forEach((piece, j) => { for (const v of piece.members) pieceOf[v] = j })
  const eps2 = (0.25 * profiles[ELEMENT.strap].spacing) ** 2
  const candidates: number[] = [], scores: number[] = []
  for (let i = 0; i < n; i++) {
    const v = sway.weld[i], o = i * 4
    if (v !== i) {
      // UV-seam twins move exactly like the first vertex at their position: the surface never cracks
      for (let c = 0; c < 4; c++) { skinIndex[o + c] = skinIndex[v * 4 + c]; skinWeight[o + c] = skinWeight[v * 4 + c] }
      continue
    }
    const p = particleOf[v]
    if (p >= 0) {
      candidates.length = 0; scores.length = 0
      for (const q of [p, ...neighbours.subarray(neighbourStart[p], neighbourStart[p + 1])]) {
        const d2 = (at[v * 3] - rest[q * 3]) ** 2 + (at[v * 3 + 1] - rest[q * 3 + 1]) ** 2 + (at[v * 3 + 2] - rest[q * 3 + 2]) ** 2
        candidates.push(q); scores.push(1 / (d2 + eps2))
      }
      const order = candidates.map((_, k) => k).sort((a, b) => scores[b] - scores[a]).slice(0, 3)
      const total = order.reduce((sum, k) => sum + scores[k], 0)
      const share = smooth(sway.w[v] / FULL_WEIGHT)
      skinWeight[o] = 1 - share
      order.forEach((k, c) => { skinIndex[o + 1 + c] = 1 + candidates[k]; skinWeight[o + 1 + c] = (share * scores[k]) / total })
      continue
    }
    const j = pieceOf[v]
    if (j >= 0) {
      const weight = built[j].fromParts ? input.parts![v * 4 + 3] : sway.w[v]
      const share = smooth(weight / Math.max(1e-6, built[j].full))
      skinWeight[o] = 1 - share
      skinIndex[o + 1] = 1 + N + j
      skinWeight[o + 1] = share
      continue
    }
    skinWeight[o] = 1
  }

  const count = (kind: number) => { let total = 0, pins = 0; for (let p = 0; p < N; p++) if (type[p] === kind) { total++; pins += pinned[p] } return `${total}/${pins}` }
  const info = [
    `particles ${N} (cloth ${count(ELEMENT.cloth)}, strap ${count(ELEMENT.strap)}, hair ${count(ELEMENT.hair)}, antenna ${count(ELEMENT.antenna)}; total/pinned)${clusters.coarse > 1 ? ` grid ×${clusters.coarse.toFixed(2)}` : ''}`,
    `links ${L}; pieces ${P} (${built.filter((piece) => piece.type === PIECE.gear).length} gear)`,
  ]
  return {
    scale, origin, up, particles: N, rest, type, mobility, pinned, hang, tether, tetherLength, restDistance,
    links, linkRest, linkType, neighbourStart, neighbours,
    pieces: P, pieceType, pivot, centroid, outward, pieceRadius, pieceAmount,
    skinIndex, skinWeight, ...field, info,
  }
}

/**
 * The shape analysis and the rig of a mesh in one go (rig.worker.ts, or the main thread when no worker starts); null
 * when the analysis finds no reliable split (the model stays rigid).
 */
export function rigFromMesh(position: ArrayLike<number>, index: ArrayLike<number> | null, hints?: BossSwayHints, up?: readonly [number, number, number]): PhysicsRig | null {
  const sway = computeSwayWeights(position, index, { hints, internals: true })
  if (!sway?.internals) return null
  return buildPhysicsRig(position, sway.internals, { parts: sway.parts, hints, overrides: hints?.physics, up })
}

/** The rig's buffers, to transfer it from the worker without copying. */
export function rigTransferables(rig: PhysicsRig): ArrayBuffer[] {
  return [
    rig.rest, rig.type, rig.mobility, rig.pinned, rig.hang, rig.tether, rig.tetherLength, rig.restDistance, rig.links,
    rig.linkRest, rig.linkType, rig.neighbourStart, rig.neighbours, rig.pieceType, rig.pivot, rig.centroid, rig.outward,
    rig.pieceRadius, rig.pieceAmount, rig.skinIndex, rig.skinWeight, rig.sdf,
  ].map((array) => array.buffer as ArrayBuffer)
}

type Field = Pick<PhysicsRig, 'sdf' | 'sdfOrigin' | 'sdfCell' | 'sdfSize'>

/**
 * Signed distance to the body at a point of the simulation frame, m (trilinear; clamped to the grid, which reaches a
 * little past the model). With `gradient`, also writes the gradient of the interpolated field (not normalised).
 */
export function sampleSdf(field: Field, x: number, y: number, z: number, gradient?: Float64Array): number {
  const { sdf, sdfOrigin, sdfCell, sdfSize } = field
  const [sx, sy, sz] = sdfSize
  const gx = Math.min(sx - 1.001, Math.max(0, (x - sdfOrigin[0]) / sdfCell))
  const gy = Math.min(sy - 1.001, Math.max(0, (y - sdfOrigin[1]) / sdfCell))
  const gz = Math.min(sz - 1.001, Math.max(0, (z - sdfOrigin[2]) / sdfCell))
  const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz)
  const tx = gx - ix, ty = gy - iy, tz = gz - iz
  const k = ix + iy * sx + iz * sx * sy, oy = sx, oz = sx * sy
  const c000 = sdf[k], c100 = sdf[k + 1], c010 = sdf[k + oy], c110 = sdf[k + 1 + oy]
  const c001 = sdf[k + oz], c101 = sdf[k + 1 + oz], c011 = sdf[k + oy + oz], c111 = sdf[k + 1 + oy + oz]
  const c00 = c000 + (c100 - c000) * tx, c10 = c010 + (c110 - c010) * tx
  const c01 = c001 + (c101 - c001) * tx, c11 = c011 + (c111 - c011) * tx
  const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty
  if (gradient) {
    gradient[0] = (((c100 - c000) * (1 - ty) + (c110 - c010) * ty) * (1 - tz) + ((c101 - c001) * (1 - ty) + (c111 - c011) * ty) * tz) / sdfCell
    gradient[1] = ((c10 - c00) * (1 - tz) + (c11 - c01) * tz) / sdfCell
    gradient[2] = (c1 - c0) / sdfCell
  }
  return c0 + (c1 - c0) * tz
}

/** Centre (x, z) of the body near the vertical axis at a height: where a piece's outward direction starts from. */
function bodyAxis(field: Field, height: number): [number, number] {
  const { sdf, sdfOrigin, sdfCell, sdfSize } = field
  const [sx, sy, sz] = sdfSize
  const Y = Math.round((height - sdfOrigin[1]) / sdfCell)
  let x = 0, z = 0, count = 0
  for (let y = Math.max(0, Y - 2); y <= Math.min(sy - 1, Y + 2); y++) {
    for (let iz = 0; iz < sz; iz++) for (let ix = 0; ix < sx; ix++) {
      if (sdf[ix + y * sx + iz * sx * sy] >= 0) continue
      const px = sdfOrigin[0] + ix * sdfCell, pz = sdfOrigin[2] + iz * sdfCell
      if (Math.abs(px) > 0.3 || Math.abs(pz) > 0.3) continue
      x += px; z += pz; count++
    }
  }
  return count ? [x / count, z / count] : [0, 0]
}

/** Joins parts of a cell whose centres are closer than `distance`. */
function mergeClose(parts: number[][], at: Float32Array, distance: number): number[][] {
  if (parts.length < 2) return parts
  const centre = parts.map((members) => {
    let x = 0, y = 0, z = 0
    for (const v of members) { x += at[v * 3]; y += at[v * 3 + 1]; z += at[v * 3 + 2] }
    return [x / members.length, y / members.length, z / members.length]
  })
  const root = parts.map((_, i) => i)
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])))
  for (let a = 0; a < parts.length; a++) for (let b = a + 1; b < parts.length; b++) {
    if (Math.hypot(centre[a][0] - centre[b][0], centre[a][1] - centre[b][1], centre[a][2] - centre[b][2]) < distance) root[find(a)] = find(b)
  }
  const merged = new Map<number, number[]>()
  parts.forEach((members, i) => {
    const list = merged.get(find(i))
    if (list) list.push(...members); else merged.set(find(i), [...members])
  })
  return [...merged.values()]
}
