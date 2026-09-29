import type { GameMap, MapView } from '../domain/types'
import { mainFloor } from './mapProjection'

/**
 * «Вид карты»: tarkov.dev publishes two drawings of most maps — top-down render tiles («Спутник») and
 * Shebuka's vector SVG scheme («Схема»). The player picks one for all maps; a map that only has one kind
 * (Lighthouse, Streets, Terminal: scheme only; Labs, Labyrinth, Icebreaker: tiles only) shows what it has.
 * Both drawings are placed through the same CRS in game coordinates, so markers line up in either view.
 */
export const MAP_VIEW_KEY = 'tarkov-map-view'
export const DEFAULT_MAP_VIEW: MapView = 'satellite'

export function readMapView(): MapView {
  try {
    const saved = localStorage.getItem(MAP_VIEW_KEY)
    return saved === 'digital' || saved === 'satellite' ? saved : DEFAULT_MAP_VIEW
  } catch {
    return DEFAULT_MAP_VIEW
  }
}

export function saveMapView(view: MapView) {
  try { localStorage.setItem(MAP_VIEW_KEY, view) } catch { /* storage unavailable */ }
}

function baseSources(map: GameMap) {
  const base = map.layers?.find((layer) => layer.name === mainFloor(map))
  return { tileUrl: base?.tileUrl ?? map.tileUrl, imageUrl: base?.imageUrl ?? map.imageUrl }
}

export function mapViewSupport(map: GameMap): Record<MapView, boolean> {
  const { tileUrl, imageUrl } = baseSources(map)
  return { satellite: Boolean(tileUrl), digital: Boolean(imageUrl) }
}

/** The preferred view when the map has it, otherwise the one it has. */
export function resolveMapView(map: GameMap, preferred: MapView): MapView {
  const support = mapViewSupport(map)
  if (support[preferred]) return preferred
  return preferred === 'satellite' ? 'digital' : 'satellite'
}

export interface MapLayerPlan {
  /** The view actually drawn. */
  view: MapView
  /** Base tiles (satellite view). */
  tileUrl?: string
  /** Base SVG (digital view); also the source of SVG floors in either view. */
  imageUrl?: string
  /** Where the SVG goes: `svgBounds` when tarkov.dev gives them, otherwise the map bounds. */
  imageBounds?: [[number, number], [number, number]]
  /** The selected floor's own tiles, drawn above the base. */
  floorTileUrl?: string
  /**
   * The selected floor from the SVG: 'with-terrain' = the scheme with the ground level and that floor (digital view);
   * 'floor-only' = just that floor's plan over the satellite render.
   */
  floorSvg?: 'with-terrain' | 'floor-only'
  /** Fade the base while a floor is drawn on top of it (tarkov.dev does the same). */
  dimBase: boolean
}

export function planMapLayers(map: GameMap, preferred: MapView, floor: string): MapLayerPlan {
  const view = resolveMapView(map, preferred)
  const { tileUrl, imageUrl } = baseSources(map)
  const baseFloor = mainFloor(map)
  const floorLayer = floor === baseFloor ? undefined : map.layers?.find((layer) => layer.name === floor)
  const floorTileUrl = floorLayer?.ownTiles !== false && floorLayer?.tileUrl && floorLayer.tileUrl !== tileUrl ? floorLayer.tileUrl : undefined
  const svgFloor = Boolean(imageUrl && floorLayer?.svgLayer)
  if (view === 'satellite') {
    const floorSvg = !floorTileUrl && svgFloor ? 'floor-only' as const : undefined
    return { view, tileUrl, imageUrl, imageBounds: map.svgBounds ?? map.bounds, floorTileUrl, floorSvg, dimBase: Boolean(floorTileUrl || floorSvg) }
  }
  const floorSvg = svgFloor ? 'with-terrain' as const : undefined
  const floorTiles = floorSvg ? undefined : floorTileUrl
  return { view, imageUrl, imageBounds: map.svgBounds ?? map.bounds, floorTileUrl: floorTiles, floorSvg, dimBase: Boolean(floorTiles) }
}

/**
 * The map with only the chosen drawing left in it, for renderers that simply take tiles when present
 * (e.g. the in-game minimap overlay): digital drops the tile URLs and uses the SVG bounds.
 */
export function mapForView(map: GameMap, preferred: MapView): GameMap {
  const view = resolveMapView(map, preferred)
  const support = mapViewSupport(map)
  if (!support.satellite || !support.digital) return map
  if (view === 'satellite') return map
  return {
    ...map,
    tileUrl: undefined,
    bounds: map.svgBounds ?? map.bounds,
    layers: map.layers?.map((layer) => ({ ...layer, tileUrl: undefined })),
  }
}
