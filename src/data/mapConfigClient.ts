import type { GameMap } from '../domain/types'

const MAP_CONFIG_URL = 'https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json'
const ATTRIBUTION = 'Карта © tarkov.dev contributors · CC BY-NC-SA 4.0'

interface RawMapConfigRoot {
  normalizedName?: string
  maps?: RawMapConfig[]
}

interface RawMapConfig {
  key?: string
  minZoom?: number
  maxZoom?: number
  transform?: number[]
  coordinateRotation?: number
  bounds?: unknown
  svgPath?: string
  tilePath?: string
  tileSize?: number
  heightRange?: number[]
  layers?: RawMapLayer[]
  author?: string
}

interface RawMapLayer {
  name?: string
  tilePath?: string
  svgPath?: string
  heightRange?: number[]
  extents?: Array<{ height?: number[] }>
}

export async function fetchMapRenderingConfigs(): Promise<Map<string, Partial<GameMap>>> {
  const response = await fetch(MAP_CONFIG_URL, { headers: { accept: 'application/json' } })
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
  const names = ['Основной', ...(config.layers ?? []).map((layer) => layer.name).filter((name): name is string => Boolean(name))]
  return [...new Set(names)]
}

function mapLayers(config: RawMapConfig): GameMap['layers'] {
  const primary = {
    id: 'main',
    name: 'Основной',
    tileUrl: config.tilePath,
    imageUrl: config.svgPath,
    heightRange: readHeightRange(config.heightRange),
  }
  const layers = (config.layers ?? []).map((layer, index) => ({
    id: `layer-${index}`,
    name: layer.name ?? `Слой ${index + 1}`,
    tileUrl: layer.tilePath ?? config.tilePath,
    imageUrl: layer.svgPath ?? config.svgPath,
    heightRange: readHeightRange(layer.heightRange) ?? readHeightRange(layer.extents?.[0]?.height),
  }))
  return [primary, ...layers]
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
