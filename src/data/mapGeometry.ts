import type { AppDataset, GameMap } from '../domain/types'

type MapGeometry = Pick<GameMap, 'transform' | 'coordinateRotation' | 'bounds' | 'svgBounds'>

/**
 * How game coordinates land on each map (tarkov.dev maps.json, as mirrored on raidos.app on 31.10.2026). A map without
 * them is drawn in plain pixels, and the player's dot from a screenshot sat in the map's bottom-left corner whatever the
 * position (player report, 31.10.2026: Улицы and Эпицентр): the offline catalog, or a catalog built without maps.json.
 */
const MAP_GEOMETRY: Record<string, MapGeometry> = {
  'streets-of-tarkov': { transform: [0.38, 0, 0.38, 0], coordinateRotation: 180, bounds: [[323, -295], [-280, 532]] },
  'ground-zero': { transform: [0.524, 167.3, 0.524, 65.1], coordinateRotation: 180, bounds: [[249, -124], [-99, 364]] },
  customs: { transform: [0.239, 168.65, 0.239, 136.35], coordinateRotation: 180, bounds: [[698, -307], [-372, 237]] },
  factory: { transform: [1.629, 119.9, 1.629, 139.3], coordinateRotation: 90, bounds: [[77, -64.5], [-65.5, 67.4]] },
  icebreaker: { transform: [2, 125, 3.5, 91], coordinateRotation: 180, bounds: [[77, -64.5], [-65.5, 67.4]] },
  interchange: { transform: [0.265, 150.6, 0.265, 134.6], coordinateRotation: 180, bounds: [[598, -442], [-433, 426]] },
  'the-lab': { transform: [0.575, 281.2, 0.575, 193.7], coordinateRotation: 270, bounds: [[-80, -477], [-287, -193]] },
  'the-labyrinth': { transform: [2.115, 85.5, 2.115, 128], coordinateRotation: 270, bounds: [[-52, -37], [53, 76]] },
  lighthouse: { transform: [0.2, 0, 0.2, 0], coordinateRotation: 180, bounds: [[515, -998], [-545, 725]] },
  reserve: { transform: [0.395, 122, 0.395, 137.65], coordinateRotation: 180, bounds: [[289, -293], [-303, 244]], svgBounds: [[289, -274], [-303, 272]] },
  shoreline: { transform: [0.16, 83.2, 0.16, 111.1], coordinateRotation: 180, bounds: [[504, -415], [-1056, 618]] },
  terminal: { transform: [0.2, 0, 0.2, 0], coordinateRotation: 180, bounds: [[463, -580], [-433, 475]] },
  woods: { transform: [0.1855, 112.95, 0.1855, 167.85], coordinateRotation: 180, bounds: [[646, -914], [-761, 442]] },
}

/** The map with its game-coordinate geometry; a map that already has a transform keeps its own. */
export function withMapGeometry(map: GameMap): GameMap {
  const geometry = map.transform ? undefined : MAP_GEOMETRY[map.id]
  return geometry ? { ...map, ...geometry } : map
}

/** The dataset with every known map able to place game coordinates (the same object when nothing was missing). */
export function withMapsGeometry(dataset: AppDataset): AppDataset {
  const maps = dataset.maps.map(withMapGeometry)
  return maps.some((map, index) => map !== dataset.maps[index]) ? { ...dataset, maps } : dataset
}
