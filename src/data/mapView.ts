import type { GameMap, MapView } from '../domain/types'
import { mainFloor } from './mapProjection'

/**
 * «Вид карты»: tarkov.dev publishes two drawings of most maps — top-down render tiles («Спутник») and
 * Shebuka's vector SVG scheme («Схема»). The player picks one for all maps; a map that only has one kind
 * (Lighthouse, Streets, Terminal: scheme only; Labs, Labyrinth, Icebreaker: tiles only) shows what it has.
 * Both drawings are placed through the same CRS in game coordinates, so markers line up in either view.
 */
export const MAP_VIEW_KEY = 'tarkov-map-view'
/** One look for every map by default: the scheme exists for all maps but Labs, Labyrinth and Icebreaker. */
export const DEFAULT_MAP_VIEW: MapView = 'digital'

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
  /**
   * The scheme laid under the render tiles. No longer drawn (04.10.2026): through the render's empty spots it showed
   * the scheme's ground floors on the satellite view. Always false.
   */
  underlay?: boolean
  /** No longer drawn (04.10.2026): it made the main level of the satellite view look like the scheme. Always false. */
  groundInteriors?: boolean
  /** Digital view, a floor the scheme has no drawing of: the scheme stays as it is (never the render tiles). */
  floorWithoutScheme?: boolean
  /** Satellite view, a floor with no render of its own: the render stays as it is (never the scheme). */
  floorWithoutRender?: boolean
}

export function planMapLayers(map: GameMap, preferred: MapView, floor: string): MapLayerPlan {
  const view = resolveMapView(map, preferred)
  const { tileUrl, imageUrl } = baseSources(map)
  const baseFloor = mainFloor(map)
  const floorLayer = floor === baseFloor ? undefined : map.layers?.find((layer) => layer.name === floor)
  const floorTileUrl = floorLayer?.ownTiles !== false && floorLayer?.tileUrl && floorLayer.tileUrl !== tileUrl ? floorLayer.tileUrl : undefined
  const svgFloor = Boolean(imageUrl && floorLayer?.svgLayer)
  if (view === 'satellite') {
    // «Спутник» is the render on every level: the floor's own render tiles, or — a floor only the scheme draws (Развязка's
    // 2nd and 3rd floors, Улицы) — the render itself, never the scheme (owner, 10.10.2026: «открывается как схема»);
    // its markers still follow the floor. No scheme under the tiles either: through the render's empty spots it showed
    // the scheme's ground floors (owner, 04.10.2026).
    return {
      view, tileUrl, imageUrl, imageBounds: map.svgBounds ?? map.bounds, floorTileUrl, floorSvg: undefined, dimBase: Boolean(floorTileUrl),
      underlay: false, groundInteriors: false, floorWithoutRender: Boolean(floorLayer) && !floorTileUrl,
    }
  }
  // «Схема» is the scheme on every level: the floor's group when the SVG has it, otherwise the scheme unchanged —
  // never the render tiles (they used to show through on Customs 4th floor and Reserve's upper floors).
  const floorSvg = svgFloor ? 'with-terrain' as const : undefined
  return { view, imageUrl, imageBounds: map.svgBounds ?? map.bounds, floorTileUrl: undefined, floorSvg, dimBase: false, floorWithoutScheme: Boolean(floorLayer) && !floorSvg }
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
