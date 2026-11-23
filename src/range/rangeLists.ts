import type { GunPart } from '../arsenal/gunTypes'
import type { ScopeData } from './rangeScope'

/**
 * The order of the range's lists (owner, 23.11.2026).
 *
 * Scopes: «с начала списка идут прицелы, которые ставятся на кольца. Потом прицелы, которые ставятся на планку. И потом уже
 * тепловизоры, ночные прицелы. И вот эти штатные прицелы ПСО-1, УСП-1… 1П-59, 1П-69» — thermal and night from the scope's own
 * data, the service optics by id, and ring or rail from the catalog: a scope is ring-mounted when a ring mount takes it.
 */
export type ScopeGroup = 'rings' | 'rail' | 'thermal' | 'night' | 'service'
export const SCOPE_GROUP_ORDER: readonly ScopeGroup[] = ['rings', 'rail', 'thermal', 'night', 'service']

/** The service optics: ПСО-1, ПСО-1М2, ПСО-1М2-1, УСП-1, 1П59, 1П69, 1П78-1, ПУ 3.5x. */
export const SERVICE_SCOPE_IDS: ReadonlySet<string> = new Set([
  '5c82342f2e221644f31c060e', '5c82343a2e221644f31c0611', '576fd4ec2459777f0b518431', '5cf638cbd7f00c06595bc936',
  '5d0a3a58d7ad1a669c15ca14', '5d0a3e8cd7ad1a6f6a3d35bd', '618a75f0bd321d49084cd399', '5b3f7c1c5acfc40dc5296b1d',
])

/**
 * A ring mount by its name: «кольца», «ring», a tube's diameter («Крепление 30мм …», 34mm, 35 мм, 25.4 мм). No \b: JavaScript's
 * word boundary knows Latin letters only, and «30мм» ends in Cyrillic ones.
 */
const RING_MOUNT = /кольц|ring|\d{2}(?:[.,]\d)?\s?(?:мм|mm)/i

/** The parts that take each item in one of their slots. */
export function parentsOf(parts: ReadonlyMap<string, GunPart>) {
  const parents = new Map<string, GunPart[]>()
  for (const part of parts.values()) {
    for (const slot of part.slots ?? []) {
      for (const id of slot.allowed) parents.set(id, [...(parents.get(id) ?? []), part])
    }
  }
  return parents
}

export function scopeGroupOf(scope: ScopeData, parents: ReadonlyMap<string, GunPart[]>): ScopeGroup {
  if (scope.modes.some((mode) => mode.thermal)) return 'thermal'
  if (scope.modes.some((mode) => mode.night)) return 'night'
  if (SERVICE_SCOPE_IDS.has(scope.id)) return 'service'
  const ring = (parents.get(scope.id) ?? []).some((parent) => RING_MOUNT.test(parent.name) || RING_MOUNT.test(parent.shortName))
  return ring ? 'rings' : 'rail'
}

/** The scopes in their groups, each group in the scopes' own order (by magnification). */
export function groupScopes(scopes: readonly ScopeData[], parts: ReadonlyMap<string, GunPart>) {
  const parents = parentsOf(parts)
  return SCOPE_GROUP_ORDER.map((group) => ({ group, scopes: scopes.filter((scope) => scopeGroupOf(scope, parents) === group) }))
}

/**
 * One colour of a model (owner, 23.11.2026: «если шлемов одинаковых несколько видов, добавь только один из них. То есть не нужно
 * разные расцветки»): the name without its colour in brackets, with its class.
 */
export const modelKey = (item: { name: string; armorClass: number }) => `${item.name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase()}|${item.armorClass}`

/**
 * One item of each model, the one that can be drawn on the figure first (a helmet with no picture of it worn is not drawn: owner,
 * «некоторые шлема, когда нажимаешь «Одеть»… он не появляется»), else the first; items that cannot be drawn are left out when
 * any of the list can (the pictures are in test builds only).
 */
export function oneOfEachModel<T extends { id: string; name: string; armorClass: number }>(items: readonly T[], drawn?: (id: string) => boolean) {
  const anyDrawn = drawn ? items.some((item) => drawn(item.id)) : false
  const byModel = new Map<string, T>()
  for (const item of items) {
    if (anyDrawn && !drawn!(item.id)) continue
    const key = modelKey(item)
    if (!byModel.has(key)) byModel.set(key, item)
  }
  return [...byModel.values()]
}

/** The same model's drawn colour for an item that cannot be drawn itself (a usual kit's helmet), if there is one. */
export function drawnVariant<T extends { id: string; name: string; armorClass: number }>(item: T | undefined, items: readonly T[], drawn?: (id: string) => boolean) {
  if (!item || !drawn || drawn(item.id)) return item
  return items.find((other) => modelKey(other) === modelKey(item) && drawn(other.id)) ?? item
}
