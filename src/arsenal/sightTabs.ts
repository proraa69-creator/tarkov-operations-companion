import type { GunPart } from './gunTypes'

/**
 * A sight slot's modules in tabs (owner, 23.11.2026: «в сборке оружия, где у нас выбор прицела… должны быть вкладки: кольца,
 * оптические прицелы, прицелы на планку и коллиматоры, тепловизоры и ночные прицелы»), by tarkov.dev's category; what fits none of
 * them (iron sights, a riser…) under «Прочее».
 */
export type SightTab = 'mounts' | 'optics' | 'rail' | 'special' | 'other'
const SIGHT_TABS: Array<{ key: SightTab; name: string; categories: string[] }> = [
  { key: 'mounts', name: 'Кольца', categories: ['mount'] },
  { key: 'optics', name: 'Оптические прицелы', categories: ['scope'] },
  { key: 'rail', name: 'Прицелы на планку и коллиматоры', categories: ['assault-scope', 'reflex-sight', 'compact-reflex-sight'] },
  { key: 'special', name: 'Тепловизоры и ночные', categories: ['special-scope'] },
  { key: 'other', name: 'Прочее', categories: [] },
]
const SIGHT_CATEGORIES = new Set(['scope', 'assault-scope', 'reflex-sight', 'compact-reflex-sight', 'special-scope'])
export function sightTabOf(part: Pick<GunPart, 'category'>): SightTab {
  return SIGHT_TABS.find((tab) => part.category !== undefined && tab.categories.includes(part.category))?.key ?? 'other'
}
/** The tabs of a slot's modules: none unless it takes sights and they fall in two tabs or more; empty tabs are left out. */
export function sightTabs(parts: ReadonlyArray<Pick<GunPart, 'category'>>): Array<{ key: SightTab; name: string; count: number }> {
  if (!parts.some((part) => part.category !== undefined && SIGHT_CATEGORIES.has(part.category))) return []
  const tabs = SIGHT_TABS.map((tab) => ({ key: tab.key, name: tab.name, count: parts.filter((part) => sightTabOf(part) === tab.key).length })).filter((tab) => tab.count > 0)
  return tabs.length > 1 ? tabs : []
}
