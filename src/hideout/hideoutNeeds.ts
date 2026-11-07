/**
 * «Убежище» (owner, 17.10.2026): every item the hideout still needs — the item requirements of every station level not
 * built yet (levels per profile and mode, `ModeProgress.hideoutLevels`), summed per item, minus what the player marked as
 * found. Money (roubles, dollars, euros) is not an item to find: it is summed apart.
 */
import type { HideoutStation } from '../domain/types'

export const ROUBLES = '5449016a4bdc2d6f028b456f'
export const DOLLARS = '5696686a4bdc2da3298b456a'
export const EUROS = '569668774bdc2da2298b4568'
const MONEY = new Set([ROUBLES, DOLLARS, EUROS])

export interface NeedUse { stationId: string; stationName: string; level: number; count: number; foundInRaid: boolean }

export interface HideoutNeed {
  itemId: string
  total: number
  found: number
  remaining: number
  /** Some level asks for it found in raid. */
  foundInRaid: boolean
  uses: NeedUse[]
}

export interface HideoutNeeds {
  items: HideoutNeed[]
  money: { roubles: number; dollars: number; euros: number }
  /** Pieces still to find over all items, and all pieces needed. */
  remaining: number
  total: number
}

/**
 * Which part of the hideout to count: `stations` — the modules ticked under their pictures (owner, 07.11.2026: «под каждой
 * картинкой сделай галочку… только предметы выбранных галочкой модулей»), every level not built of each; `level` — one level of
 * one module, built or not (owner, 07.11.2026: «я нажимаю правой кнопкой на биткоин-ферму второго уровня, и он мне показывает,
 * что нужно для биткоин-фермы второго уровня. Только для нее»). A string is one module.
 */
export interface HideoutNeedsFilter { stations?: ReadonlySet<string>; level?: { stationId: string; level: number } }

export function hideoutNeeds(stations: HideoutStation[], built: Record<string, number>, found: ReadonlyMap<string, number>, only?: string | HideoutNeedsFilter): HideoutNeeds {
  const filter: HideoutNeedsFilter = typeof only === 'string' ? { stations: new Set([only]) } : only ?? {}
  const byItem = new Map<string, NeedUse[]>()
  const money = { roubles: 0, dollars: 0, euros: 0 }
  for (const station of stations) {
    if (filter.level ? station.id !== filter.level.stationId : filter.stations?.size && !filter.stations.has(station.id)) continue
    const level = built[station.id] ?? 0
    for (const stage of station.levels ?? []) {
      if (filter.level ? stage.level !== filter.level.level : stage.level <= level) continue
      for (const requirement of stage.itemRequirements ?? []) {
        const count = Math.max(1, Math.round(requirement.count))
        if (requirement.itemId === ROUBLES) { money.roubles += count; continue }
        if (requirement.itemId === DOLLARS) { money.dollars += count; continue }
        if (requirement.itemId === EUROS) { money.euros += count; continue }
        if (MONEY.has(requirement.itemId)) continue
        const uses = byItem.get(requirement.itemId) ?? []
        uses.push({ stationId: station.id, stationName: station.name, level: stage.level, count, foundInRaid: Boolean(requirement.foundInRaid) })
        byItem.set(requirement.itemId, uses)
      }
    }
  }
  const items = [...byItem].map(([itemId, uses]): HideoutNeed => {
    const total = uses.reduce((sum, use) => sum + use.count, 0)
    const have = Math.min(total, Math.max(0, found.get(itemId) ?? 0))
    return { itemId, total, found: have, remaining: total - have, foundInRaid: uses.some((use) => use.foundInRaid), uses: uses.sort((a, b) => a.level - b.level) }
  })
  return {
    items,
    money,
    remaining: items.reduce((sum, item) => sum + item.remaining, 0),
    total: items.reduce((sum, item) => sum + item.total, 0),
  }
}
