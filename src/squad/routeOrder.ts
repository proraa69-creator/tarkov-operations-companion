/**
 * A simple raid route: greedy nearest neighbour over map points (map coordinates, [lat, lng] as the markers store
 * them). Not a safety guarantee or a shortest path — just an order in which the objectives are close to each other.
 */
export type RoutePoint = { position: [number, number] }

const distance = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Orders the points starting from `start` (an index into `points`, default the first one). */
export function orderNearestNeighbour<T extends RoutePoint>(points: T[], start = 0): T[] {
  if (points.length <= 2) return [...points]
  const rest = points.map((point, index) => ({ point, index })).filter((entry) => Number.isFinite(entry.point.position[0]) && Number.isFinite(entry.point.position[1]))
  const invalid = points.filter((point) => !Number.isFinite(point.position[0]) || !Number.isFinite(point.position[1]))
  const first = rest.findIndex((entry) => entry.index === start)
  const ordered: T[] = []
  let current = rest.splice(first >= 0 ? first : 0, 1)[0]
  while (current) {
    ordered.push(current.point)
    if (!rest.length) break
    let best = 0
    for (let index = 1; index < rest.length; index += 1) {
      if (distance(current.point.position, rest[index].point.position) < distance(current.point.position, rest[best].point.position)) best = index
    }
    current = rest.splice(best, 1)[0]
  }
  return [...ordered, ...invalid]
}

/** Total length of a route, for tests and for comparing orders. */
export function routeLength(points: RoutePoint[]) {
  let total = 0
  for (let index = 1; index < points.length; index += 1) total += distance(points[index - 1].position, points[index].position)
  return total
}
