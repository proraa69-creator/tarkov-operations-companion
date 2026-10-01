import type { MapMarker, ModeProgress, Quest } from '../domain/types'
import { currentStoryStageIndex, isCurrentTrackedQuest } from '../progression/requirementEngine'
import { objectiveDone } from './objectives'

export type Point = [number, number]

/** One place to visit. Points sharing `group` are alternatives (e.g. possible spots of one objective): one is visited. */
export interface RouteTarget {
  id: string
  position: Point
  group: string
  /** The objective this step is for (its description), never a judgement of the place. */
  title: string
  questId?: string
  objectiveType?: string
  /** Floor of the point when it is not on the ground level. */
  floor?: string
}

const NON_PLOTTED = new Set(['quest-fallback', 'quest-any-map', 'quest-info'])

/**
 * Objective zones of the current quests on this map (story chapters: their current stage only). Objectives already
 * done (when per-objective progress is known) are left out.
 */
export function routeTargets(markers: MapMarker[], quests: Quest[], progress: ModeProgress, mapId: string): RouteTarget[] {
  const current = new Map(quests.filter((quest) => isCurrentTrackedQuest(quest, progress)).map((quest) => [quest.id, quest]))
  return markers.flatMap((marker) => {
    if (marker.mapId !== mapId || !marker.questId || NON_PLOTTED.has(marker.source ?? '') || marker.approximate) return []
    if (marker.layerId !== 'quest.zone' && marker.layerId !== 'quest.item' && marker.type !== 'quest') return []
    const quest = current.get(marker.questId)
    if (!quest) return []
    if (marker.stageIndex != null && marker.stageIndex !== currentStoryStageIndex(quest, progress)) return []
    if (objectiveDone(progress, quest.id, marker.objectiveId)) return []
    const [lat, lng] = marker.position
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return []
    const objective = marker.objectiveId ? quest.objectiveDetails?.find((entry) => entry.id === marker.objectiveId) : undefined
    return [{
      id: marker.id,
      position: marker.position,
      group: marker.objectiveId ?? marker.id,
      title: objective?.description || marker.title,
      questId: marker.questId,
      ...(objective?.type ? { objectiveType: objective.type } : {}),
      ...(marker.floor ? { floor: marker.floor } : {}),
    }]
  })
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Length of an open path from `start` through `path`. */
export function routeLength(start: Point, path: Array<{ position: Point }>) {
  let total = 0
  let previous = start
  for (const step of path) {
    total += distance(previous, step.position)
    previous = step.position
  }
  return total
}

/**
 * Orders the targets into a short open path from `start`: nearest neighbour over the groups (the nearest candidate of
 * any unvisited group), then 2-opt and a per-group candidate swap until nothing improves.
 */
export function orderRoute(start: Point, targets: RouteTarget[]): RouteTarget[] {
  const groups = new Map<string, RouteTarget[]>()
  for (const target of targets) {
    const list = groups.get(target.group) ?? []
    list.push(target)
    groups.set(target.group, list)
  }
  const path: RouteTarget[] = []
  const left = new Set(groups.keys())
  let at = start
  while (left.size) {
    let best: RouteTarget | undefined
    for (const group of left) {
      for (const candidate of groups.get(group)!) {
        if (!best || distance(at, candidate.position) < distance(at, best.position) - 1e-9) best = candidate
      }
    }
    path.push(best!)
    left.delete(best!.group)
    at = best!.position
  }
  return improveRoute(start, path, groups)
}

function improveRoute(start: Point, path: RouteTarget[], groups: Map<string, RouteTarget[]>) {
  const route = [...path]
  const n = route.length
  const at = (index: number) => index < 0 ? start : route[index].position
  let improved = true
  let rounds = 0
  while (improved && rounds++ < 50) {
    improved = false
    // 2-opt on an open path: reverse route[i..j]; the last point has no successor.
    for (let i = 0; i < n - 1; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const before = distance(at(i - 1), route[i].position) + (j + 1 < n ? distance(route[j].position, route[j + 1].position) : 0)
        const after = distance(at(i - 1), route[j].position) + (j + 1 < n ? distance(route[i].position, route[j + 1].position) : 0)
        if (after < before - 1e-6) {
          route.splice(i, j - i + 1, ...route.slice(i, j + 1).reverse())
          improved = true
        }
      }
    }
    // Alternatives: take the candidate of each group that fits best between its neighbours.
    for (let index = 0; index < n; index += 1) {
      const candidates = groups.get(route[index].group) ?? []
      if (candidates.length < 2) continue
      const cost = (target: RouteTarget) => distance(at(index - 1), target.position) + (index + 1 < n ? distance(target.position, route[index + 1].position) : 0)
      const best = candidates.reduce((winner, candidate) => cost(candidate) < cost(winner) - 1e-6 ? candidate : winner, route[index])
      if (best !== route[index]) {
        route[index] = best
        improved = true
      }
    }
  }
  return route
}

/** Default start when the user has not clicked one: the extract that gives the shortest route. */
export function bestStartExtract<T extends { position: Point }>(extracts: T[], targets: RouteTarget[]): T | undefined {
  let best: { extract: T; length: number } | undefined
  for (const extract of extracts) {
    const length = routeLength(extract.position, orderRoute(extract.position, targets))
    if (!best || length < best.length) best = { extract, length }
  }
  return best?.extract
}

export interface RoutePlan {
  /** Where the route starts: the user's click, else the best PMC extract. */
  start?: Point
  /** Title of the extract used as the default start; absent for a start the user clicked. */
  startExtract?: string
  startIsCustom: boolean
  steps: RouteTarget[]
  /** Route length in map units (game metres on tarkov.dev maps). */
  length: number
}

/** The whole route of a map: targets of the current quests, the start (user click or best extract) and the order. */
export function planRoute(markers: MapMarker[], quests: Quest[], progress: ModeProgress, mapId: string, customStart: Point | null): RoutePlan {
  const targets = routeTargets(markers, quests, progress, mapId)
  if (customStart) {
    const steps = orderRoute(customStart, targets)
    return { start: customStart, startIsCustom: true, steps, length: routeLength(customStart, steps) }
  }
  const extracts = markers.filter((marker) => marker.mapId === mapId && marker.layerId === 'extract.pmc' && !NON_PLOTTED.has(marker.source ?? ''))
  const extract = targets.length ? bestStartExtract(extracts, targets) : undefined
  if (!extract) return { startIsCustom: false, steps: targets.length ? orderRoute(targets[0].position, targets) : [], length: 0 }
  const steps = orderRoute(extract.position, targets)
  return { start: extract.position, startExtract: extract.title, startIsCustom: false, steps, length: routeLength(extract.position, steps) }
}

/** «①→②→③» for up to 20 steps, plain numbers after that. */
export function stepNumber(index: number) {
  return index < 20 ? String.fromCodePoint(0x2460 + index) : `(${index + 1})`
}
