import L, { CRS, type LatLngBoundsExpression } from 'leaflet'
import type { GameMap } from '../domain/types'

const defaultBounds: LatLngBoundsExpression = [[0, 0], [1000, 1000]]

export function toLeafletBounds(map: GameMap): LatLngBoundsExpression {
  if (!map.bounds) return defaultBounds
  return [[map.bounds[0][1], map.bounds[0][0]], [map.bounds[1][1], map.bounds[1][0]]]
}

export function createMapCrs(map: GameMap) {
  if (!map.transform) return CRS.Simple
  const [scaleX, marginX, scaleY, marginY] = map.transform
  const rotation = map.coordinateRotation ?? 0
  return L.extend({}, CRS.Simple, {
    transformation: new L.Transformation(scaleX, marginX, scaleY * -1, marginY),
    projection: L.extend({}, L.Projection.LonLat, {
      project: (point: L.LatLng) => L.Projection.LonLat.project(rotate(point, rotation)),
      unproject: (point: L.Point) => rotate(L.Projection.LonLat.unproject(point), rotation * -1),
    }),
  })
}

function rotate(point: L.LatLng, rotation: number) {
  if ((!point.lng && !point.lat) || !rotation) return point
  const angle = rotation * Math.PI / 180
  const x = point.lng * Math.cos(angle) - point.lat * Math.sin(angle)
  const y = point.lng * Math.sin(angle) + point.lat * Math.cos(angle)
  return L.latLng(y, x)
}
