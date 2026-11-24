import { decodeBuild, loadSavedBuilds, type SavedBuild } from '../arsenal/buildStorage'
import type { Build, GunCatalog } from '../arsenal/gunTypes'
import type { RaidMode } from '../domain/types'

export const MODE_NAMES: Record<RaidMode, [string, string]> = { pvp: ['PvP', 'PvP'], pve: ['PvE', 'PvE'], seasonal: ['Сезон', 'Season'] }

export interface RangeSavedBuild extends SavedBuild { mode: RaidMode }

/**
 * Every saved build of a weapon, from every mode (owner, 22.11.2026: «все сборки, которые у меня есть, с ПВЕ, ПВП и сезонного
 * режима будут там. И каждая будет подписана ПВЕ, ПВП, сезон»), favourites first, then the newest.
 */
export function savedBuildsOf(weaponId: string): RangeSavedBuild[] {
  return (['pvp', 'pve', 'seasonal'] as const).flatMap((mode) => loadSavedBuilds(mode).filter((entry) => entry.weaponId === weaponId).map((entry) => ({ ...entry, mode })))
    .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || b.savedAt.localeCompare(a.savedAt))
}

export function decodeSaved(entry: RangeSavedBuild | undefined, catalog: GunCatalog): Build | undefined {
  return entry ? decodeBuild(entry.code, catalog) : undefined
}
