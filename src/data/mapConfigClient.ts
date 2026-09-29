import type { GameMap, MapFloorExtent, MapFloorLayer } from '../domain/types'
import { localizeFloorName, MAIN_FLOOR } from './mapProjection'

const MAP_CONFIG_URL = 'https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json'
const ATTRIBUTION = 'Карта © tarkov.dev contributors · CC BY-NC-SA 4.0'

interface RawMapConfigRoot {
  normalizedName?: string
  maps?: RawMapConfig[]
}

interface RawMapConfig {
  svgLayer?: string
  key?: string
  minZoom?: number
  maxZoom?: number
  transform?: number[]
  coordinateRotation?: number
  bounds?: unknown
  svgBounds?: unknown
  svgPath?: string
  tilePath?: string
  tileSize?: number
  heightRange?: number[]
  layers?: RawMapLayer[]
  author?: string
}

interface RawMapLayer {
  svgLayer?: string
  name?: string
  tilePath?: string
  svgPath?: string
  heightRange?: number[]
  extents?: RawExtent[] | RawExtent
}

interface RawExtent {
  height?: number[]
  bounds?: unknown[]
}

export async function fetchMapRenderingConfigs(): Promise<Map<string, Partial<GameMap>>> {
  const response = await fetch(MAP_CONFIG_URL, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`maps.json: HTTP ${response.status}`)
  const roots = await response.json() as RawMapConfigRoot[]
  return adaptMapRenderingConfigs(Array.isArray(roots) ? roots : [])
}

export function adaptMapRenderingConfigs(roots: RawMapConfigRoot[]): Map<string, Partial<GameMap>> {
  const configs = new Map<string, Partial<GameMap>>()
  for (const root of roots) {
    const primary = root.maps?.find((entry) => entry.tilePath || entry.svgPath) ?? root.maps?.[0]
    const normalizedName = root.normalizedName ?? primary?.key
    if (!normalizedName || !primary) continue
    configs.set(normalizedName, {
      tileUrl: primary.tilePath,
      imageUrl: primary.svgPath,
      bounds: readBounds(primary.bounds),
      // Only Reserve has it today: the SVG covers a slightly different area than the tiles.
      svgBounds: primary.svgPath ? readBounds(primary.svgBounds) : undefined,
      transform: readTransform(primary.transform),
      coordinateRotation: number(primary.coordinateRotation),
      tileSize: number(primary.tileSize) || undefined,
      minZoom: number(primary.minZoom),
      maxZoom: number(primary.maxZoom),
      floors: mapFloors(primary),
      layers: mapLayers(primary),
      attribution: primary.author ? `Карта © ${primary.author} / tarkov.dev · CC BY-NC-SA 4.0` : ATTRIBUTION,
    })
  }
  return configs
}

function mapFloors(config: RawMapConfig) {
  const names = [MAIN_FLOOR, ...(config.layers ?? []).map((layer) => layer.name).filter((name): name is string => Boolean(name)).map(localizeFloorName)]
  return [...new Set(names)]
}

function mapLayers(config: RawMapConfig): GameMap['layers'] {
  const primary: MapFloorLayer = {
    id: 'main',
    svgLayer: config.svgLayer,
    name: MAIN_FLOOR,
    tileUrl: config.tilePath,
    imageUrl: config.svgPath,
    heightRange: readHeightRange(config.heightRange),
    ownTiles: true,
  }
  const layers = (config.layers ?? []).filter((layer) => layer.name).map((layer, index): MapFloorLayer => {
    const extents = readExtents(layer.extents)
    return {
      id: `layer-${index}`,
      svgLayer: layer.svgLayer,
      name: localizeFloorName(layer.name ?? `Слой ${index + 1}`),
      tileUrl: layer.tilePath ?? config.tilePath,
      imageUrl: layer.svgPath ?? config.svgPath,
      heightRange: readHeightRange(layer.heightRange) ?? extents[0]?.height,
      extents: extents.length ? extents : undefined,
      ownTiles: Boolean(layer.tilePath || layer.svgPath),
    }
  })
  return [primary, ...layers]
}

function readExtents(value: RawMapLayer['extents']): MapFloorExtent[] {
  const list = Array.isArray(value) ? value : value ? [value] : []
  return list.flatMap((extent) => {
    const height = readHeightRange(extent?.height)
    if (!height) return []
    const bounds = (Array.isArray(extent.bounds) ? extent.bounds : []).flatMap((box) => {
      if (!Array.isArray(box)) return []
      const first = readPair(box[0])
      const second = readPair(box[1])
      return first && second ? [[first, second] as [[number, number], [number, number]]] : []
    })
    return [{ height, bounds: bounds.length ? bounds : undefined }]
  })
}

function readBounds(value: unknown): [[number, number], [number, number]] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const first = readPair(value[0])
  const second = readPair(value[1])
  return first && second ? [first, second] : undefined
}

function readPair(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const first = number(value[0])
  const second = number(value[1])
  return Number.isFinite(first) && Number.isFinite(second) ? [first, second] : undefined
}

function readTransform(value: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length < 4) return undefined
  const parsed = value.slice(0, 4).map(number)
  return parsed.every(Number.isFinite) ? parsed as [number, number, number, number] : undefined
}

function readHeightRange(value: unknown): [number, number] | undefined {
  const pair = readPair(value)
  if (!pair) return undefined
  return [Math.min(pair[0], pair[1]), Math.max(pair[0], pair[1])]
}

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.parseFloat(String(value))
}
