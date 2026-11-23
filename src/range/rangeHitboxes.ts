/**
 * The range target's hit zones, front and back: the game's colliders (EBodyPartColliderType) and plate colliders
 * (EArmorPlateCollider) laid out on a 178 cm figure standing with its arms down, in centimetres (x to the viewer's right,
 * y up from the feet). The shapes are ours — sizes of a real body and of the plates (SAPI 24×32 cm, side plates 15×20 cm) —
 * not the game's meshes. Seen from the front the character's left side is on the viewer's right.
 */
import type { Collider, HitSpot, PlateZone } from './rangeModel'

export type View = 'front' | 'back'

export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r?: number }
  /** The part of an ellipse between two heights (and, if given, beyond |x| ≥ xMin or within |x| ≤ xMax). */
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; yMin?: number; yMax?: number; xMin?: number; xMax?: number }

export interface Region { collider: Collider; shape: Shape; /** Higher wins where regions overlap. */ z: number }
export interface PlateRegion { zone: PlateZone; shape: Shape }

export const FIGURE_HEIGHT = 178
export const HEAD = { cx: 0, cy: 165, rx: 9.5, ry: 12 }

const head = (yMin?: number, yMax?: number, extra: { xMin?: number; xMax?: number } = {}): Shape => ({ kind: 'ellipse', ...HEAD, yMin, yMax, ...extra })
const rect = (x0: number, x1: number, y0: number, y1: number, r = 2): Shape => ({ kind: 'rect', x: x0, y: y0, w: x1 - x0, h: y1 - y0, r })
/** Viewer-side x of a character side: in the front view the character's left is on the viewer's right. */
const side = (view: View, characterLeft: boolean) => (view === 'front') === characterLeft ? 1 : -1

function limbs(view: View): Region[] {
  const left = side(view, true), right = side(view, false)
  const arm = (s: number, upper: Collider, fore: Collider): Region[] => [
    { collider: upper, shape: rect(Math.min(19 * s, 26 * s), Math.max(19 * s, 26 * s), 112, 146, 3), z: 2 },
    { collider: fore, shape: rect(Math.min(19.5 * s, 25.5 * s), Math.max(19.5 * s, 25.5 * s), 78, 112, 3), z: 2 },
  ]
  const leg = (s: number, thigh: Collider, calf: Collider): Region[] => [
    { collider: thigh, shape: rect(Math.min(1.5 * s, 15.5 * s), Math.max(1.5 * s, 15.5 * s), 50, 90, 4), z: 1 },
    { collider: calf, shape: rect(Math.min(3 * s, 13 * s), Math.max(3 * s, 13 * s), 4, 50, 4), z: 1 },
  ]
  return [...arm(left, 'LeftUpperArm', 'LeftForearm'), ...arm(right, 'RightUpperArm', 'RightForearm'), ...leg(left, 'LeftThigh', 'LeftCalf'), ...leg(right, 'RightThigh', 'RightCalf')]
}

function torso(view: View): Region[] {
  const left = side(view, true), right = side(view, false)
  const span = (s: number, a: number, b: number) => [Math.min(a * s, b * s), Math.max(a * s, b * s)] as const
  const flank = (s: number, up: Collider, down: Collider): Region[] => [
    { collider: up, shape: rect(...span(s, 14.5, 19), 124, 145, 2), z: 3 },
    { collider: down, shape: rect(...span(s, 14, 17.5), 104, 124, 2), z: 3 },
  ]
  const front = view === 'front'
  return [
    { collider: front ? 'NeckFront' : 'NeckBack', shape: rect(-5.5, 5.5, 145, 155, 2), z: 4 },
    { collider: front ? 'RibcageUp' : 'SpineTop', shape: rect(-15, 15, 122, 147, 5), z: 2 },
    { collider: front ? 'RibcageLow' : 'SpineDown', shape: rect(-14.5, 14.5, 104, 122, 2), z: 2 },
    { collider: front ? 'Pelvis' : 'PelvisBack', shape: rect(-16, 16, 88, 104, 4), z: 2 },
    ...flank(left, 'LeftSideChestUp', 'LeftSideChestDown'),
    ...flank(right, 'RightSideChestUp', 'RightSideChestDown'),
  ]
}

function headRegions(view: View): Region[] {
  const ears: Region = { collider: 'Ears', shape: head(157, 167, { xMin: 7.5 }), z: 7 }
  if (view === 'back') return [
    { collider: 'ParietalHead', shape: head(171), z: 6 },
    ears,
    { collider: 'BackHead', shape: head(undefined, 171), z: 5 },
  ]
  return [
    { collider: 'ParietalHead', shape: head(171), z: 6 },
    ears,
    { collider: 'Eyes', shape: head(162.5, 166.5, { xMax: 7.5 }), z: 6 },
    { collider: 'Jaw', shape: head(undefined, 158.5, { xMax: 7.5 }), z: 6 },
    { collider: 'HeadCommon', shape: head(), z: 5 },
  ]
}

export function regions(view: View): Region[] {
  return [...headRegions(view), ...torso(view), ...limbs(view)].sort((a, b) => b.z - a.z)
}

export function plateRegions(view: View): PlateRegion[] {
  const left = side(view, true), right = side(view, false)
  const span = (s: number, a: number, b: number) => [Math.min(a * s, b * s), Math.max(a * s, b * s)] as const
  const sides = (s: number, characterLeft: boolean): PlateRegion[] => {
    const name = characterLeft ? 'left' : 'right'
    return [
      { zone: `Plate_Granit_SSAPI_side_${name}_high` as PlateZone, shape: rect(...span(s, 15, 19), 126, 142, 1.5) },
      { zone: `Plate_Granit_SSAPI_side_${name}_low` as PlateZone, shape: rect(...span(s, 14.5, 17.5), 108, 123, 1.5) },
      { zone: `Plate_Korund_side_${name}_high` as PlateZone, shape: rect(...span(s, 14.5, 19), 124, 144, 1.5) },
      { zone: `Plate_Korund_side_${name}_low` as PlateZone, shape: rect(...span(s, 14, 17.5), 106, 124, 1.5) },
    ]
  }
  const front = view === 'front'
  return [
    { zone: front ? 'Plate_Granit_SAPI_chest' : 'Plate_Granit_SAPI_back', shape: rect(-12, 12, 114, 145, 3) },
    { zone: front ? 'Plate_Korund_chest' : 'Plate_6B13_back', shape: rect(-13.5, 13.5, 108, 146, 3) },
    ...sides(left, true), ...sides(right, false),
  ]
}

export function inside(shape: Shape, x: number, y: number) {
  if (shape.kind === 'rect') return x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h
  const dx = (x - shape.cx) / shape.rx, dy = (y - shape.cy) / shape.ry
  if (dx * dx + dy * dy > 1) return false
  if (shape.yMin !== undefined && y < shape.yMin) return false
  if (shape.yMax !== undefined && y >= shape.yMax) return false
  if (shape.xMin !== undefined && Math.abs(x - shape.cx) < shape.xMin) return false
  if (shape.xMax !== undefined && Math.abs(x - shape.cx) > shape.xMax) return false
  return true
}

/**
 * What a bullet meets at a point: the body collider there, the plate collider over it when one of `plates` (the zones the
 * kit's plates cover) is laid there, and on the head the angle to its rounded surface (for ricochets). Undefined: a miss.
 */
export function hitAt(view: View, x: number, y: number, plates: ReadonlySet<PlateZone> = new Set()): HitSpot | undefined {
  const region = regions(view).find((entry) => inside(entry.shape, x, y))
  if (!region) return undefined
  const plate = plateRegions(view).find((entry) => plates.has(entry.zone) && inside(entry.shape, x, y))?.zone
  const onHead = region.collider === 'HeadCommon' || region.collider === 'ParietalHead' || region.collider === 'BackHead' || region.collider === 'Ears' || region.collider === 'Eyes' || region.collider === 'Jaw'
  let angle: number | undefined
  if (onHead) {
    const dx = (x - HEAD.cx) / HEAD.rx, dy = (y - HEAD.cy) / HEAD.ry
    angle = Math.asin(Math.min(1, Math.hypot(dx, dy))) * 180 / Math.PI
  }
  return { collider: region.collider, ...(plate ? { plate } : {}), ...(angle !== undefined ? { angle } : {}) }
}

/** The middle of a collider's zone in a view (aiming at a zone in the comparison). */
export function zoneCentre(view: View, collider: Collider): { x: number; y: number } | undefined {
  const region = regions(view).find((entry) => entry.collider === collider)
  if (!region) return undefined
  const shape = region.shape
  if (shape.kind === 'rect') return { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 }
  const yMin = shape.yMin ?? shape.cy - shape.ry, yMax = shape.yMax ?? shape.cy + shape.ry
  const y = (yMin + yMax) / 2
  const x = shape.xMin !== undefined ? shape.cx + (shape.xMin + shape.rx) / 2 : shape.cx
  return { x, y }
}

/** SVG path of a shape (y flipped: SVG grows down; the figure stands on y = 0). */
export function shapePath(shape: Shape): string {
  const Y = (y: number) => FIGURE_HEIGHT - y
  if (shape.kind === 'rect') {
    const r = Math.min(shape.r ?? 0, shape.w / 2, shape.h / 2)
    const x0 = shape.x, x1 = shape.x + shape.w, y0 = Y(shape.y + shape.h), y1 = Y(shape.y)
    return `M${x0 + r},${y0}H${x1 - r}Q${x1},${y0} ${x1},${y0 + r}V${y1 - r}Q${x1},${y1} ${x1 - r},${y1}H${x0 + r}Q${x0},${y1} ${x0},${y1 - r}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}Z`
  }
  // An ellipse band: its right and left edges sampled between the band's heights, within the x limits.
  const { cx, cy, rx, ry } = shape
  const lo = Math.max(shape.yMin ?? -Infinity, cy - ry), hi = Math.min(shape.yMax ?? Infinity, cy + ry)
  const half = (y: number) => rx * Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2))
  const piece = (from: (y: number) => number, to: (y: number) => number) => {
    const ys: number[] = []
    for (let i = 0; i <= 40; i++) ys.push(lo + (hi - lo) * i / 40)
    const valid = ys.filter((y) => to(y) > from(y) + 0.01)
    if (valid.length < 2) return ''
    const right = valid.map((y) => `${to(y).toFixed(2)},${Y(y).toFixed(2)}`)
    const left = [...valid].reverse().map((y) => `${from(y).toFixed(2)},${Y(y).toFixed(2)}`)
    return `M${[...right, ...left].join('L')}Z`
  }
  if (shape.xMin !== undefined) {
    const xMin = shape.xMin
    return piece(() => cx + xMin, (y) => cx + half(y)) + piece((y) => cx - half(y), () => cx - xMin)
  }
  if (shape.xMax !== undefined) {
    const xMax = shape.xMax
    return piece((y) => cx - Math.min(xMax, half(y)), (y) => cx + Math.min(xMax, half(y)))
  }
  return piece((y) => cx - half(y), (y) => cx + half(y))
}

/** The figure's outline for a view (all regions, drawn under the zones). */
export function silhouette(view: View) {
  return regions(view).map((region) => shapePath(region.shape))
}

/**
 * The figure's outline (SVG path, both views): a mannequin over the zones, so the target reads as a body and not as boxes.
 * The right half (x ≥ 0) from the neck to the crotch, mirrored for the left; the head is the HEAD ellipse.
 */
type Point = readonly [number, number]
type Segment = { c1?: Point; c2?: Point; p: Point }
const HALF_START: Point = [5.2, 155]
const HALF: Segment[] = [
  { p: [5.6, 149] },
  { c1: [9, 147.6], c2: [14, 147.6], p: [18.5, 146.6] },
  { c1: [23, 145.6], c2: [26.3, 143], p: [26.3, 138] },
  { p: [26.2, 118] },
  { c1: [26.2, 114], c2: [25.8, 112], p: [25.6, 110] },
  { p: [25.3, 84] },
  { c1: [25.4, 80], c2: [24.3, 76.4], p: [22.5, 76.4] },
  { c1: [20.8, 76.4], c2: [19.7, 79], p: [19.8, 82] },
  { p: [19.5, 104] },
  { p: [19.1, 112] },
  { p: [19, 126] },
  { c1: [19, 128], c2: [18.6, 129], p: [18.2, 129] },
  { c1: [18, 122], c2: [17.2, 112], p: [16.8, 106] },
  { c1: [16.6, 100], c2: [16.9, 94], p: [16.3, 90] },
  { c1: [16.1, 80], c2: [15.7, 66], p: [14.7, 54] },
  { c1: [14.3, 50], c2: [13.7, 48], p: [13.5, 46] },
  { c1: [14.1, 38], c2: [13.7, 24], p: [12.2, 12] },
  { p: [12.1, 6] },
  { c1: [12.1, 3.5], c2: [11.5, 2], p: [10, 2] },
  { p: [4.5, 2] },
  { c1: [3.2, 2], c2: [3, 3.5], p: [3, 5] },
  { c1: [3.2, 20], c2: [3, 34], p: [3.4, 46] },
  { c1: [2.6, 60], c2: [2, 76], p: [1.6, 88] },
  { c1: [1.2, 89.5], c2: [0.6, 90], p: [0, 90] },
]

export function bodyOutline(): string {
  const Y = (y: number) => (FIGURE_HEIGHT - y).toFixed(2)
  const pt = ([x, y]: Point) => `${x.toFixed(2)},${Y(y)}`
  const seg = (segment: Segment) => segment.c1 && segment.c2 ? `C${pt(segment.c1)} ${pt(segment.c2)} ${pt(segment.p)}` : `L${pt(segment.p)}`
  const right = `M${pt(HALF_START)}${HALF.map(seg).join('')}`
  // the left half: the same segments walked back from the crotch to the neck, mirrored
  const points: Point[] = [HALF_START, ...HALF.map((segment) => segment.p)]
  const mirror = ([x, y]: Point): Point => [-x, y]
  let left = ''
  for (let i = HALF.length - 1; i >= 0; i--) {
    const segment = HALF[i]!
    const to = mirror(points[i]!)
    left += segment.c1 && segment.c2 ? `C${pt(mirror(segment.c2))} ${pt(mirror(segment.c1))} ${pt(to)}` : `L${pt(to)}`
  }
  return `${right}${left}Z`
}
