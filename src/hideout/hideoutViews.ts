/**
 * The hideout's own pictures (owner, 20.11.2026: «3D-визуализацию, как при входе в убежище… всё убежище было видно в одном кадре…
 * каждый модуль… визуально меняется, как в игре»): taken in the offline copy of the game on E: by the BepInEx plugin RaidOsHideout
 * (E:\SPT-photo\hideout), turned into webp by scripts/hideout-views.mjs. `overview.webp` — the whole hideout at the highest levels;
 * `<station id>-<level>.webp` — a module from its own camera in the game at that level (0: not built). The station id is the game's
 * area template id, the same as tarkov.dev's. hideoutViews.json keeps where every module's button sits on the overview (the game's
 * own area icon point, projected by the camera of the picture) and which levels have a picture.
 */
import views from '../data/hideoutViews.json'

const files = import.meta.glob<string>('../assets/hideout-views/*.webp', { eager: true, import: 'default' })
const byName = new Map(Object.entries(files).map(([path, url]) => [path.split('/').pop()!.replace(/\.webp$/, ''), url]))

export interface HideoutViewsFile {
  overview?: { width: number; height: number }
  /** Station id → the button's place on the overview, [x, y] in 0..1 of its width and height. */
  spots: Record<string, number[]>
  /** Station id → the levels with a picture. */
  levels: Record<string, number[]>
}

const file = views as HideoutViewsFile

export const overviewSize = file.overview
export const overviewPicture = () => byName.get('overview')

export function moduleSpot(stationId: string): { x: number; y: number } | undefined {
  const spot = file.spots[stationId]
  return spot && spot.length === 2 ? { x: spot[0]!, y: spot[1]! } : undefined
}

/** The module's picture at a level; a level without one shows the nearest lower level that has one. */
export function modulePicture(stationId: string, level: number): string | undefined {
  for (let at = level; at >= 0; at -= 1) {
    const url = byName.get(`${stationId}-${at}`)
    if (url) return url
  }
  return undefined
}

export const hasModulePictures = (stationId: string) => (file.levels[stationId]?.length ?? 0) > 0
