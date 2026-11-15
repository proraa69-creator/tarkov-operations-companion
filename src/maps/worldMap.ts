import type { GameMap } from '../domain/types'

/**
 * «Общая карта» (owner, 15.11.2026: «просто приколюха»; «сделать одну большую карту и на ней разместить вот эти маленькие…
 * перенеси квесты по вот этой большой карте, текущие. Примерно, не надо прям супер точно»).
 *
 * The big map is our own drawing of the region (src/assets/world-map/region.webp, scripts/world-map/make-world-map.py),
 * drawn over a stencil: tarkov.dev's «openworld-2d» («Nick's Open World V5» by LastNickLeft, the-hideout/tarkov-dev, MIT),
 * which gives where the locations lie and how they join (owner: «карту мы делаем с нуля… по трафарету»; no source name
 * is shown to players). The drawing has no game coordinates, so each location got its place on it by hand: the centre of
 * its scheme on the drawing and the drawing's pixels per game metre there, fitted by laying our scheme over the stencil.
 * A quest point goes
 *
 *   game [z, x] ──(the location's CRS at zoom 0, as on «Карты»)──▶ location pixel ──(× its scale, + its offset)──▶ drawing
 *
 * so it stands on its scheme exactly as on «Карты», and on the region about where the stencil has that location.
 */

/** A point on the big map: pixels of the 4096 px drawing, x to the right, y down. */
export type WorldPoint = [number, number]
export type PixelRect = [[number, number], [number, number]]

/** The drawing's size in world units. */
export const WORLD_SIZE = 4096

export interface WorldSpot {
  /** Where the centre of the location's scheme lies on the drawing. */
  center: WorldPoint
  /** The drawing's pixels per game metre there. */
  scale: number
}

/**
 * Each location on the drawing. The Labyrinth is not in the stencil (it lies under Shoreline): it stands in the sea off
 * Shoreline, marked «под землёй».
 */
export const WORLD_LAYOUT: Readonly<Record<string, WorldSpot>> = {
  // the lake, the sawmill's loop and the ponds in the north
  woods: { center: [1309, 1377], scale: 0.795 },
  // the tank farm, the dorms beyond the river, the river and the buildings south of the main road
  customs: { center: [1997, 2186], scale: 1.07 },
  // on the big building north of Customs
  factory: { center: [1680, 1965], scale: 1 },
  // the two trench lines and the buildings (the stencil turns Reserve by about 10°; the scheme is not turned)
  reserve: { center: [1360, 2740], scale: 1.15 },
  // the water treatment plant, the serpentine roads and the coast
  lighthouse: { center: [483, 3284], scale: 0.86 },
  // between the ridge east of Lighthouse and the river: the resort, the coast road; its south-east corner meets Terminal
  shoreline: { center: [1610, 3460], scale: 0.97 },
  // the stencil's small port
  terminal: { center: [2300, 3935], scale: 0.3 },
  // the mall and the highway west of it
  interchange: { center: [2980, 1891], scale: 0.56 },
  // Primorsky Ave and the cross streets
  'streets-of-tarkov': { center: [2612, 785], scale: 1.25 },
  // north of Streets on the same avenue
  'ground-zero': { center: [2650, 230], scale: 0.8 },
  // where the stencil has the Lab
  'the-lab': { center: [2400, 150], scale: 0.8 },
  // not in the stencil (under Shoreline): in the sea south of Shoreline's pier
  'the-labyrinth': { center: [1000, 3990], scale: 0.87 },
}

/** Where a location's name stands when the top of its place is crowded (the north-east, Factory beside Customs). */
export const LABEL_AT: Readonly<Record<string, WorldPoint>> = {
  'the-lab': [2390, 55],
  'ground-zero': [2870, 150],
  'streets-of-tarkov': [2930, 620],
  factory: [1560, 1885],
  customs: [2090, 1890],
}

/** The point a location's name stands on: its own spot, or the top middle of its place. */
export function labelPoint(placement: WorldPlacement): WorldPoint {
  const [[x1, y1], [x2]] = placement.rect
  return LABEL_AT[placement.mapId] ?? [(x1 + x2) / 2, y1]
}

/** Locations below ground. */
export const UNDERGROUND_LOCATIONS: ReadonlySet<string> = new Set(['the-lab', 'the-labyrinth'])

type Geometry = Pick<GameMap, 'id' | 'transform' | 'coordinateRotation' | 'bounds' | 'svgBounds'>

/**
 * Leaflet's pixel at zoom 0 of a game point [lat = z, lng = x] on the location's own map: the projection of
 * createMapCrs (rotation, then the transform; Leaflet's CRS.Simple scale is 1 at zoom 0).
 */
export function locationPixel(map: Pick<GameMap, 'transform' | 'coordinateRotation'>, [lat, lng]: [number, number]): [number, number] {
  const [scaleX, marginX, scaleY, marginY] = map.transform ?? [1, 0, 1, 0]
  const rotation = map.coordinateRotation ?? 0
  let x = lng
  let y = lat
  // mapCrs.ts rotate(): skipped for the origin and for no rotation
  if (rotation && (lat || lng)) {
    const angle = rotation * Math.PI / 180
    x = lng * Math.cos(angle) - lat * Math.sin(angle)
    y = lng * Math.sin(angle) + lat * Math.cos(angle)
  }
  return [scaleX * x + marginX, -scaleY * y + marginY]
}

/** The pixel rectangle (zoom 0) a box of game [x, z] corners covers on the location's map. */
export function pixelRect(map: Pick<GameMap, 'transform' | 'coordinateRotation'>, box: [[number, number], [number, number]]): PixelRect {
  const [[x1, z1], [x2, z2]] = box
  const corners = [[z1, x1], [z2, x1], [z1, x2], [z2, x2]].map(([lat, lng]) => locationPixel(map, [lat, lng]))
  const xs = corners.map(([x]) => x)
  const ys = corners.map(([, y]) => y)
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]]
}

export interface WorldPlacement {
  mapId: string
  /** World units per location pixel at zoom 0, per axis: the spot's scale / the transform's scale. */
  scale: [number, number]
  /** World point of the location's pixel (0, 0). */
  offset: WorldPoint
  /** Where the location's picture (its scheme, or its tiles' bounds) lies on the canvas. */
  rect: [WorldPoint, WorldPoint]
}

/** The location's place on the canvas; none for a location without geometry or a place in the layout. */
export function placeLocation(map: Geometry, layout: Readonly<Record<string, WorldSpot>> = WORLD_LAYOUT): WorldPlacement | null {
  const spot = layout[map.id]
  const box = map.svgBounds ?? map.bounds
  const transform = map.transform
  if (!spot || !box || !transform || !transform[0] || !transform[2]) return null
  const { center } = spot
  const scale: [number, number] = [spot.scale / Math.abs(transform[0]), spot.scale / Math.abs(transform[2])]
  const [[px1, py1], [px2, py2]] = pixelRect(map, box)
  const offset: WorldPoint = [center[0] - (px1 + px2) / 2 * scale[0], center[1] - (py1 + py2) / 2 * scale[1]]
  return { mapId: map.id, scale, offset, rect: [toWorldPixel({ scale, offset }, [px1, py1]), toWorldPixel({ scale, offset }, [px2, py2])] }
}

function toWorldPixel(placement: Pick<WorldPlacement, 'scale' | 'offset'>, [px, py]: [number, number]): WorldPoint {
  return [placement.offset[0] + px * placement.scale[0], placement.offset[1] + py * placement.scale[1]]
}

/** A marker's position ([lat = z, lng = x], as MapMarker.position) on the canvas. */
export function toWorld(placement: WorldPlacement, map: Pick<GameMap, 'transform' | 'coordinateRotation'>, position: [number, number]): WorldPoint {
  return toWorldPixel(placement, locationPixel(map, position))
}

/**
 * Where the location's own map opens on the canvas (its `bounds`, as «Карты» fits them; the scheme's bounds when it has none):
 * a flight into it ends on the very picture its map then opens with.
 */
export function openingRect(placement: WorldPlacement, map: Pick<GameMap, 'transform' | 'coordinateRotation' | 'bounds' | 'svgBounds'>): [WorldPoint, WorldPoint] {
  const box = map.bounds ?? map.svgBounds
  if (!box) return placement.rect
  const [[x1, z1], [x2, z2]] = box
  const corners = [[z1, x1], [z1, x2], [z2, x1], [z2, x2]].map(([z, x]) => toWorld(placement, map, [z!, x!]))
  const xs = corners.map(([x]) => x)
  const ys = corners.map(([, y]) => y)
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]]
}

/** The canvas is drawn with Leaflet's CRS.Simple: lat = -y, lng = x. */
export const worldLatLng = ([x, y]: WorldPoint): [number, number] => [-y, x]

/** Leaflet bounds of a world rectangle. */
export const worldBounds = ([[x1, y1], [x2, y2]]: [WorldPoint, WorldPoint]): [[number, number], [number, number]] => [worldLatLng([x1, y2]), worldLatLng([x2, y1])]

export interface WorldTile {
  url: string
  rect: [WorldPoint, WorldPoint]
}

/**
 * A location with no scheme (Labs, Labyrinth): its render tiles of one zoom, each placed as a picture of its own. Tile
 * (i, j) at zoom z covers the location pixels i·size / 2^z … (i + 1)·size / 2^z at zoom 0, as Leaflet's TileLayer has it.
 * The zoom gives the whole location about `targetPixels` across, within the zooms the tiles exist for.
 */
export function worldTiles(map: Pick<GameMap, 'tileUrl' | 'tileSize' | 'minZoom' | 'maxZoom' | 'bounds' | 'transform' | 'coordinateRotation'>, placement: WorldPlacement, targetPixels = 1400): WorldTile[] {
  if (!map.tileUrl || !map.bounds) return []
  const size = map.tileSize ?? 256
  const [[px1, py1], [px2, py2]] = pixelRect(map, map.bounds)
  const across = Math.max(px2 - px1, py2 - py1)
  const wanted = Math.round(Math.log2(targetPixels / across))
  const zoom = Math.max(map.minZoom ?? 0, Math.min(map.maxZoom ?? wanted, wanted))
  const step = size / 2 ** zoom
  const tiles: WorldTile[] = []
  for (let i = Math.floor(px1 / step); i * step < px2; i += 1) {
    for (let j = Math.floor(py1 / step); j * step < py2; j += 1) {
      if (i < 0 || j < 0) continue
      tiles.push({
        url: map.tileUrl.replace('{z}', String(zoom)).replace('{x}', String(i)).replace('{y}', String(j)),
        rect: [toWorldPixel(placement, [i * step, j * step]), toWorldPixel(placement, [(i + 1) * step, (j + 1) * step])],
      })
    }
  }
  return tiles
}

/** Do two world rectangles meet? */
export function rectsMeet([[ax1, ay1], [ax2, ay2]]: [WorldPoint, WorldPoint], [[bx1, by1], [bx2, by2]]: [WorldPoint, WorldPoint]) {
  return ax1 < bx2 && bx1 < ax2 && ay1 < by2 && by1 < ay2
}

/**
 * The location under a point of the map: the smallest place that holds it (Factory over Customs, Ground Zero over Streets), or
 * none. The floors are switched for it while the map is close up (owner, 15.11.2026: «этажи переключаются только на участки,
 * который виден в карте»).
 */
export function locationAt(placements: Iterable<WorldPlacement>, [x, y]: WorldPoint): string | null {
  let best: { id: string; area: number } | null = null
  for (const { mapId, rect: [[x1, y1], [x2, y2]] } of placements) {
    if (x < x1 || x > x2 || y < y1 || y > y2) continue
    const area = (x2 - x1) * (y2 - y1)
    if (!best || area < best.area) best = { id: mapId, area }
  }
  return best?.id ?? null
}

/**
 * The size of a location's picture, px: light for the whole map, detailed (`close`) only while it is close up and in
 * sight — a picture per screen pixel of the map at its middle zooms, never past what a browser draws fast.
 */
export function pictureSize({ rect: [[x1, y1], [x2, y2]] }: WorldPlacement, close: boolean, phone = false): [number, number] {
  const [width, height] = [x2 - x1, y2 - y1]
  const long = Math.max(width, height)
  // the phone (owner, 15.11.2026: «добавить на мобильное приложение… чтобы она работала плавно»): smaller pictures
  const side = close
    ? (phone ? Math.min(1536, Math.max(768, long * 1.6)) : Math.min(2560, Math.max(1024, long * 2.5)))
    : (phone ? Math.min(512, Math.max(192, long * 0.35)) : Math.min(768, Math.max(256, long * 0.5)))
  return [Math.round(side * width / long), Math.round(side * height / long)]
}
