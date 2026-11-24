/**
 * «Только найдено в рейде» in «Сезон» (owner, 28.10.2026: «да, брать из PvP»): tarkov.dev's Season data marks no hideout
 * requirement found in raid (0 of 317, json.tarkov.dev/pvp-season/hideout), while PvP and PvE mark 76; the hideout is the
 * same game's. A Season catalog without a single found-in-raid requirement takes PvP's marks: station, level and item as
 * in PvP's data (pvpHideoutFoundInRaid.json, from json.tarkov.dev/regular/hideout, 28.10.2026). A mode whose data marks
 * any requirement keeps its own.
 */
import type { HideoutStation, RaidMode } from '../domain/types'
import PVP_MARKS from './pvpHideoutFoundInRaid.json'

const marks = new Set<string>(PVP_MARKS)

export function withSeasonFoundInRaid(stations: HideoutStation[], mode: RaidMode): HideoutStation[] {
  if (mode !== 'seasonal') return stations
  if (stations.some((station) => station.levels?.some((level) => level.itemRequirements?.some((requirement) => requirement.foundInRaid)))) return stations
  return stations.map((station) => ({
    ...station,
    levels: station.levels?.map((level) => ({
      ...level,
      itemRequirements: level.itemRequirements?.map((requirement) => marks.has(`${station.id}:${level.level}:${requirement.itemId}`) ? { ...requirement, foundInRaid: true } : requirement),
    })),
  }))
}
