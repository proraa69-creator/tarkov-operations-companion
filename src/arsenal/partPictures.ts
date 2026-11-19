/**
 * The build's picture made of the game's own part pictures (owner, 20.11.2026: «я выбрал магазин… у меня поставился магазин. Я выбрал
 * прицел… поставился прицел»; «делай уже по новой системе сборки… по картинке модуля, с заменой модулей прямо в прямом эфире»). Every
 * weapon and module was drawn once by the game itself, alone, from the side (an offline copy of the game, the RaidOsGuns plugin): its
 * picture, the depth of every pixel and the points of its slots. Only these pictures and numbers are used; no model leaves the game.
 *
 * A build is laid like the game puts it together: each part at its parent's slot point. A slot's bone turned as most are holds the part
 * upright; another turn about the barrel's axis turns the picture (a grip hung under a rail is upside down). A part turned towards the
 * eye (a side mount) has no picture from that side yet: it is left out and named in `missing`.
 */
import type { Build, BuildNode } from './gunTypes'

/** One part's picture: size, the pixel of its origin, the depth range (metres along the view) and its slots (position xyz, turn xyzw). */
export interface PartAsset { w: number; h: number; o: [number, number]; d: [number, number]; s: Record<string, number[]> }
export interface PartsIndex { ppm: number; parts: Record<string, PartAsset> }

type Mat3 = [number, number, number, number, number, number, number, number, number]
const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

function quat([x, y, z, w]: number[]): Mat3 {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ]
}
const mul = (a: Mat3, b: Mat3): Mat3 => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!)) as Mat3
const transpose = (a: Mat3): Mat3 => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]
const apply = (a: Mat3, v: [number, number, number]): [number, number, number] =>
  [a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2]]
/** The turn of most slot bones (-90° about X): it holds a part upright. */
const STANDARD_BACK = transpose(quat([-0.70711, 0, 0, 0.70711]))
/**
 * Barrels the game drew alone hanging from their hinge (a break-action or a quick-change barrel: the weapon's own pose closes it in the
 * game, owner 20.11.2026: «МР-18 разложенное… ствол смотрит вниз… ствол должен быть цельным»): a quarter turn about the view at their
 * mount lays them along the weapon, the muzzle forward, with what is on them.
 */
export const HINGED_BARRELS: ReadonlySet<string> = new Set([
  '61f4012adfc9f01a816adda1', // MP-18 600 mm
  '646371faf2404ab67905c8e9', // ПКМ 658 mm
  '6513eff1e06849f06c0957d4', // РПД 520 mm
])
const CLOSE_HINGE = quat([-0.70711, 0, 0, 0.70711])

/** A part where it stands in the picture: its picture's pixels go through `m` (2×3, to the build's pixels); `x` its place along the view. */
export interface PlacedPart {
  tpl: string
  asset: PartAsset
  /** Picture pixel (u, v) → build pixel: [a, b, c, d, e, f] as u' = a·u + b·v + c, v' = d·u + e·v + f. */
  m: [number, number, number, number, number, number]
  /** The part's origin along the view (metres), to which its depth range adds. */
  x: number
}

/**
 * `anchors`: where each slot of a drawn part is on the picture (pixels), by the slot's path in the build (slot ids joined by «/»): the
 * point an empty slot's cell points at. `centers`: the middle of each drawn part's picture by its path, for the cell of a filled slot.
 */
export interface LaidBuild {
  parts: PlacedPart[]
  missing: string[]
  width: number
  height: number
  near: number
  far: number
  anchors: Record<string, [number, number]>
  centers: Record<string, [number, number]>
}

/**
 * The build laid out: every part covered by the index at its place, the picture's size (pixels at the index's scale) and the depth range.
 * `missing`: parts with no picture yet, or turned out of the side view.
 */
export function layBuild(build: Build, index: PartsIndex): LaidBuild {
  const ppm = index.ppm
  const placed: PlacedPart[] = []
  const missing: string[] = []
  const anchors: Record<string, [number, number]> = {}
  const centers: Record<string, [number, number]> = {}
  const partPaths: string[] = []
  const walk = (tpl: string, node: BuildNode | undefined, at: [number, number, number], given: Mat3, path: string) => {
    const turn = HINGED_BARRELS.has(tpl) ? mul(given, CLOSE_HINGE) : given
    const asset = index.parts[tpl]
    if (!asset) { missing.push(tpl); return }
    // the X axis (the view) kept or turned round: the picture turns in its plane; any other turn faces the part towards the eye
    if (Math.abs(Math.abs(turn[0]) - 1) > 1e-3) { missing.push(tpl); return }
    // a local (y, z) goes to turn·(y, z); in pixels right is -z, down is -y
    const [a, b, d, e] = [turn[8], turn[7], turn[5], turn[4]]
    const cx = -at[2] * ppm
    const cy = -at[1] * ppm
    const [ux, uy] = asset.o
    placed.push({ tpl, asset, x: at[0], m: [a, b, cx - a * ux - b * uy, d, e, cy - d * ux - e * uy] })
    partPaths.push(path)
    for (const [slotId, slot] of Object.entries(asset.s)) {
      const offset = apply(turn, [slot[0]!, slot[1]!, slot[2]!])
      anchors[path ? `${path}/${slotId}` : slotId] = [-(at[2] + offset[2]) * ppm, -(at[1] + offset[1]) * ppm]
    }
    for (const [slotId, child] of Object.entries(node?.children ?? {})) {
      const slot = asset.s[slotId]
      if (!slot) { missing.push(child.itemId); continue }
      const offset = apply(turn, [slot[0]!, slot[1]!, slot[2]!])
      walk(child.itemId, child, [at[0] + offset[0], at[1] + offset[1], at[2] + offset[2]], mul(mul(turn, quat(slot.slice(3))), STANDARD_BACK), path ? `${path}/${slotId}` : slotId)
    }
  }
  walk(build.weaponId, build.root, [0, 0, 0], IDENTITY, '')
  // the picture's box: every part's corners through its placing
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity]
  let [near, far] = [Infinity, -Infinity]
  for (const part of placed) {
    for (const [u, v] of [[0, 0], [part.asset.w, 0], [0, part.asset.h], [part.asset.w, part.asset.h]] as const) {
      const px = part.m[0] * u + part.m[1] * v + part.m[2]
      const py = part.m[3] * u + part.m[4] * v + part.m[5]
      left = Math.min(left, px); right = Math.max(right, px); top = Math.min(top, py); bottom = Math.max(bottom, py)
    }
    near = Math.min(near, part.x + part.asset.d[0])
    far = Math.max(far, part.x + part.asset.d[1])
  }
  if (!placed.length) return { parts: [], missing, width: 0, height: 0, near: 0, far: 1, anchors: {}, centers: {} }
  // the box's corner to (0, 0)
  for (const part of placed) { part.m[2] -= left; part.m[5] -= top }
  for (const point of Object.values(anchors)) { point[0] -= left; point[1] -= top }
  placed.forEach((part, index) => {
    const [w, h] = [part.asset.w / 2, part.asset.h / 2]
    centers[partPaths[index]!] = [part.m[0] * w + part.m[1] * h + part.m[2], part.m[3] * w + part.m[4] * h + part.m[5]]
  })
  return { parts: placed, missing, width: Math.ceil(right - left), height: Math.ceil(bottom - top), near, far, anchors, centers }
}
