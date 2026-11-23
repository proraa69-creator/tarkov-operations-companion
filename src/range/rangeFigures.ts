/**
 * The range's pictures (owner, 22.11.2026: «Сделай снимки персонажа спереди сзади, так же всех боссов, бронежилетов, бронеразгрузок,
 * шлемов спереди и сзади»): rendered in the game's offline copy (E:\SPT-photo\studio: the game's own bot profiles dressed by its
 * inventory screen's model loader, drawn from the front and the back; every armour, rig, helmet, mask and pair of glasses worn on the
 * same hidden body, so it lies on any character as a layer), with the game's hit colliders laid on each body. Shipped in test
 * builds only, as one encrypted pack (src/arsenal/partPack.ts), like the weapon part pictures.
 *
 * Places are in the figure's centimetres: x to the viewer's right from between the feet, y up from the soles.
 */
import type { Collider, HitSpot, PlateZone, BodyPart } from './rangeModel'
import type { KitChoice } from './rangeArmor'
import type { View } from './rangeHitboxes'

export { RANGE_PACK_FILE, RANGE_PACK_NAME, RANGE_PICTURES_BASE } from './rangePack'

export interface FigureZone {
  type: Collider
  part: BodyPart
  plate?: PlateZone
  /** Distance from the camera (nearer is hit first). */
  depth: number
  poly: Array<[number, number]>
}

export interface FigurePicture {
  file: string
  /** Left edge and top, centimetres. */
  x: number
  top: number
  width: number
  height: number
  zones?: FigureZone[]
}

export interface FigureIndex {
  scale: number
  /** By picture name, then by view: front, back, or r000…r350 (a turn round the body, «Конструктор»). */
  pictures: Record<string, Partial<Record<string, FigurePicture>>>
  /** The PMC clothes («upper-…», «lower-…»): their names and the sides they are for («usec», «bear» or «usec,bear»). */
  labels?: Record<string, { ru: string; en: string; side: string }>
}

/** The pictures a character in a kit is drawn with, bottom first: the bare character, then the armour as it is worn. */
export function figureLayers(index: FigureIndex, targetKey: string, choice: KitChoice, view: View): { base: FigurePicture; layers: FigurePicture[] } | undefined {
  const base = index.pictures[`bare-${targetKey}`]?.[view] ?? index.pictures['body-pmcusec']?.[view]
  if (!base) return undefined
  const worn = (name: string | undefined) => (name ? index.pictures[`worn-${name}`]?.[view] : undefined)
  const helmet = choice.helmet ? (choice.visor ? worn(`${choice.helmet}-${choice.visor}`) : undefined) ?? worn(choice.helmet) : undefined
  const layers = [worn(choice.body), worn(choice.face), worn(choice.eyewear), helmet].filter((layer): layer is FigurePicture => Boolean(layer))
  return { base, layers }
}

/** Whether a point is inside a polygon (even–odd). */
export function insidePolygon(poly: ReadonlyArray<readonly [number, number]>, x: number, y: number) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const HEAD_COLLIDERS = new Set<Collider>(['HeadCommon', 'ParietalHead', 'BackHead', 'Ears', 'Eyes', 'Jaw'])

/**
 * What a bullet meets at a point of a pictured body: the nearest body collider there and, in front of it, the nearest plate collider
 * of the plates the kit has; on the head the angle to its rounded surface (for ricochets). Undefined: a miss.
 */
export function hitOnFigure(zones: FigureZone[], x: number, y: number, plates: ReadonlySet<PlateZone> = new Set()): HitSpot | undefined {
  const nearest = (list: FigureZone[]) => list.filter((zone) => insidePolygon(zone.poly, x, y)).sort((a, b) => a.depth - b.depth)[0]
  const body = nearest(zones.filter((zone) => !zone.plate))
  if (!body) return undefined
  const plate = nearest(zones.filter((zone) => zone.plate && plates.has(zone.plate)))
  let angle: number | undefined
  if (HEAD_COLLIDERS.has(body.type)) {
    const head = zones.find((zone) => zone.type === 'HeadCommon' && !zone.plate) ?? body
    const xs = head.poly.map(([px]) => px), ys = head.poly.map(([, py]) => py)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const r = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 * 1.25
    angle = Math.asin(Math.min(1, Math.hypot(x - cx, y - cy) / r)) * 180 / Math.PI
  }
  return { collider: body.type, ...(plate?.plate ? { plate: plate.plate } : {}), ...(angle !== undefined ? { angle } : {}) }
}

/** Where to write a body part's health on a picture: the middle of its biggest zone. */
export function partLabelPoints(zones: FigureZone[]): Partial<Record<BodyPart, { x: number; y: number }>> {
  const best: Partial<Record<BodyPart, { area: number; x: number; y: number }>> = {}
  for (const zone of zones) {
    if (zone.plate) continue
    const xs = zone.poly.map(([x]) => x), ys = zone.poly.map(([, y]) => y)
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
    if ((best[zone.part]?.area ?? 0) < area) best[zone.part] = { area, x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
  }
  return Object.fromEntries(Object.entries(best).map(([part, value]) => [part, { x: value!.x, y: value!.y }]))
}
