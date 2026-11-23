import type { GunPart, GunSlot } from './gunTypes'

/**
 * A sight slot's modules in tabs (owner, 23.11.2026: «в сборке оружия, где у нас выбор прицела… должны быть вкладки: кольца,
 * оптические прицелы, прицелы на планку и коллиматоры, тепловизоры и ночные прицелы»), by tarkov.dev's category; what fits none of
 * them (iron sights…) under «Прочее».
 *
 * An optical scope goes on in rings (owner, 24.11.2026: «В оптических прицелах у нас должны быть кольца… Сначала мы выбираем
 * кольца и планки, а потом появляется у нас в следующем окне уже оптические прицелы»): on a rail «Оптические прицелы» lists the
 * rings — a mount with a seat for an optical scope only — and the scopes themselves show in the ring's own window. A scope that
 * goes straight on the rail, with a mount of its own (ADO P4, the ПСО on the dovetail), is a rail scope («А вот этот оптический
 * прицел… перенеси в прицелы на планку»).
 */
export type SightTab = 'mounts' | 'optics' | 'rail' | 'special' | 'other'
const SIGHT_TABS: Array<{ key: SightTab; name: string }> = [
  { key: 'mounts', name: 'Кольца' },
  { key: 'optics', name: 'Оптические прицелы' },
  { key: 'rail', name: 'Прицелы на планку и коллиматоры' },
  { key: 'special', name: 'Тепловизоры и ночные' },
  { key: 'other', name: 'Прочее' },
]
const SIGHT_CATEGORIES = new Set(['scope', 'assault-scope', 'reflex-sight', 'compact-reflex-sight', 'special-scope'])
const RAIL_SIGHTS = new Set(['assault-scope', 'reflex-sight', 'compact-reflex-sight'])

type Part = Pick<GunPart, 'category'> & { slots?: GunSlot[] }
export interface PartsLookup { mods: ReadonlyMap<string, Pick<GunPart, 'category'>> }

/** A ring's seat: a slot that takes optical scopes and nothing else (Lobaev 30 мм, NF 34 мм…); a riser's takes red dots too. */
export function isScopeSeat(slot: Pick<GunSlot, 'allowed'>, catalog: PartsLookup) {
  const parts = slot.allowed.flatMap((id) => catalog.mods.get(id) ?? [])
  return parts.length > 0 && parts.every((part) => part.category === 'scope')
}
/** The seat for the optical scope on a ring, if the part is a ring. */
export function ringSeat(part: Part, catalog: PartsLookup): GunSlot | undefined {
  return part.category === 'mount' ? part.slots?.find((slot) => isScopeSeat(slot, catalog)) : undefined
}

/**
 * The tabs a module shows in, the first its own: a ring under «Оптические прицелы» and «Кольца» both; a scope in a ring's seat is
 * an optical scope, one on a rail is a rail scope.
 */
export function sightTabsOf(part: Part, catalog: PartsLookup, onScopeSeat: boolean): SightTab[] {
  const category = part.category ?? ''
  if (category === 'mount') return ringSeat(part, catalog) ? ['optics', 'mounts'] : ['mounts']
  if (category === 'scope') return [onScopeSeat ? 'optics' : 'rail']
  if (RAIL_SIGHTS.has(category)) return ['rail']
  if (category === 'special-scope') return ['special']
  return ['other']
}

/** The tabs of a slot's modules: none unless it takes sights and they fall in two tabs or more; empty tabs are left out. */
export function sightTabs(parts: ReadonlyArray<Part>, catalog: PartsLookup, onScopeSeat: boolean): Array<{ key: SightTab; name: string; count: number }> {
  if (!parts.some((part) => part.category !== undefined && SIGHT_CATEGORIES.has(part.category))) return []
  const each = parts.map((part) => sightTabsOf(part, catalog, onScopeSeat))
  const tabs = SIGHT_TABS.map((tab) => ({ key: tab.key, name: tab.name, count: each.filter((keys) => keys.includes(tab.key)).length })).filter((tab) => tab.count > 0)
  return tabs.length > 1 ? tabs : []
}
