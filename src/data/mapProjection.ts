import type { GameMap, MapMarker } from '../domain/types'

export interface GamePosition {
  x?: unknown
  y?: unknown
  z?: unknown
}

export function positionToLatLng(position: GamePosition | undefined): [number, number] | undefined {
  const x = number(position?.x)
  const z = number(position?.z)
  return Number.isFinite(x) && Number.isFinite(z) ? [z, x] : undefined
}

export function outlineToLatLng(outline: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(outline)) return undefined
  const points = outline.map((point) => positionToLatLng(point as GamePosition)).filter((point): point is [number, number] => Boolean(point))
  return points.length >= 3 ? points : undefined
}

export function markerPosition(position: GamePosition | undefined, outline: unknown): [number, number] | undefined {
  return polygonCenter(outlineToLatLng(outline)) ?? positionToLatLng(position)
}

export function heightRange(top: unknown, bottom: unknown): [number, number] | undefined {
  const parsedTop = number(top)
  const parsedBottom = number(bottom)
  if (!Number.isFinite(parsedTop) || !Number.isFinite(parsedBottom)) return undefined
  return [Math.min(parsedTop, parsedBottom), Math.max(parsedTop, parsedBottom)]
}

export function markerFloor(map: GameMap, range: [number, number] | undefined): string | undefined {
  if (!range || !map.layers?.length) return map.floors?.[0]
  const layer = map.layers.find((entry) => entry.heightRange && rangesOverlap(range, entry.heightRange))
  return layer?.name ?? map.floors?.[0]
}

export function markerVisibleOnFloor(marker: MapMarker, floor: string) {
  return !marker.floor || marker.floor === floor
}

function polygonCenter(points: Array<[number, number]> | undefined): [number, number] | undefined {
  if (!points?.length) return undefined
  const lat = points.reduce((sum, point) => sum + point[0], 0) / points.length
  const lng = points.reduce((sum, point) => sum + point[1], 0) / points.length
  return [lat, lng]
}

function rangesOverlap(first: [number, number], second: [number, number]) {
  return first[0] <= second[1] && second[0] <= first[1]
}

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.parseFloat(String(value))
}
