import { defaultOverviewLayout, sanitizeOverviewLayout, type OverviewLayout } from '../overview/overviewLayout'
import { PHONE_BLOCKS } from '../overview/phoneLayout'
import type { BlockTitle, OverviewDefaults } from '../overview/overviewDefaults'
import { asMapBossEntry, BUILT_IN_MAP_BOSSES, type MapBossEntry } from '../data/bossRoster'

/** «Админ панель» → «Блоки» (src/admin/AdminBlocksSection.tsx): the owner's draft and what is sent to the server. */
export const OVERVIEW_DEFAULTS_PATH = '/v1/accounts/me/admin/overview-defaults'

/**
 * What the owner edits: every part filled in (the built-in values where the server has none). `bosses`: only the maps
 * whose list the owner changed (the others keep the built-in bosses).
 */
export interface BlocksDraft { layout: OverviewLayout; phone: string[]; hidden: string[]; titles: Record<string, BlockTitle>; bosses: Record<string, MapBossEntry[]> }

const copyList = (list: readonly MapBossEntry[]) => list.map((entry) => ({ ...entry, modes: [...entry.modes] }))

export function draftOf(defaults: OverviewDefaults | null | undefined): BlocksDraft {
  return {
    layout: defaults?.layout ? sanitizeOverviewLayout(defaults.layout) : defaultOverviewLayout(),
    phone: defaults?.phone ? [...defaults.phone] : [...PHONE_BLOCKS],
    hidden: [...(defaults?.hidden ?? [])],
    titles: { ...(defaults?.titles ?? {}) },
    bosses: Object.fromEntries(Object.entries(defaults?.bosses ?? {}).map(([mapId, list]) => [mapId, copyList(list)])),
  }
}

/** The body of PUT …/overview-defaults (empty headings dropped). */
export function bodyOf(draft: BlocksDraft): OverviewDefaults {
  const titles = Object.fromEntries(Object.entries(draft.titles).map(([id, title]) => [id, { ru: title.ru.trim(), en: title.en.trim() }]).filter(([, title]) => (title as BlockTitle).ru || (title as BlockTitle).en))
  return { layout: draft.layout, phone: draft.phone, hidden: draft.hidden, titles, ...(Object.keys(draft.bosses).length ? { bosses: draft.bosses } : {}) }
}

/** A map's built-in bosses as the editor lists them (every mode spelled out). */
export const builtInMapBosses = (mapId: string): MapBossEntry[] => (BUILT_IN_MAP_BOSSES[mapId] ?? []).map(asMapBossEntry)

/** The list the owner sees for a map: their own, or the built-in one to start from. */
export const draftMapBosses = (bosses: Record<string, MapBossEntry[]>, mapId: string): MapBossEntry[] => copyList(bosses[mapId] ?? builtInMapBosses(mapId))

/** The owner's lists with a map's new list; one equal to the built-in list is no change, so the map follows the built-in bosses. */
export function withMapBosses(bosses: Record<string, MapBossEntry[]>, mapId: string, list: MapBossEntry[]): Record<string, MapBossEntry[]> {
  const next = { ...bosses }
  if (JSON.stringify(list) === JSON.stringify(builtInMapBosses(mapId))) delete next[mapId]
  else next[mapId] = copyList(list)
  return next
}
