/**
 * «Где взять» an item a quest or the hideout wants (owner, 20.11.2026: «можно скрафтить на верстаке или можно скрафтить в санузле.
 * Либо если этот предмет можно поменять в круге сектантов… можно добыть в круге сектантов… можно посмотреть бартеры предметов»):
 * every hideout craft that makes it, every trader barter that gives it and every cultist circle exchange it drops from.
 * Crafts and barters are the mode's own (economy snapshot, tarkov.dev per mode); the circle is hideout/cultistCircle.ts.
 */
import type { Barter, Craft, EconomySnapshot, ItemCount } from '../data/economyApi'
import { circleRows, stackCount, type CircleRow } from './cultistCircle'

export interface CraftSource {
  kind: 'craft'
  key: string
  craft: Craft
  /** Pieces of the item the craft gives. */
  count: number
}

export interface BarterSource {
  kind: 'barter'
  key: string
  barter: Barter
  count: number
}

export interface CircleSource {
  kind: 'circle'
  key: string
  row: CircleRow
  count: number
  /** Only by chance (the wiki's «and/or»). */
  maybe: boolean
}

export type ItemSource = CraftSource | BarterSource | CircleSource

const countOf = (list: readonly ItemCount[], itemId: string) => list.filter((entry) => entry.itemId === itemId).reduce((sum, entry) => sum + entry.count, 0)

/**
 * Where an item comes from, crafts first (by station, then level), then barters (by trader level), then the circle. A craft or a
 * barter that takes the item itself in (a fuel refill, a container swap) is not a way to get it.
 */
export function itemSources(itemId: string, snapshot: Pick<EconomySnapshot, 'crafts' | 'barters'> | undefined, rows: readonly CircleRow[] = circleRows()): ItemSource[] {
  const sources: ItemSource[] = []
  for (const craft of snapshot?.crafts ?? []) {
    const count = countOf(craft.rewardItems, itemId)
    if (count > 0 && countOf(craft.requiredItems, itemId) < count) sources.push({ kind: 'craft', key: `craft:${craft.id}`, craft, count })
  }
  for (const barter of snapshot?.barters ?? []) {
    const count = countOf(barter.rewardItems, itemId)
    if (count > 0 && countOf(barter.requiredItems, itemId) < count) sources.push({ kind: 'barter', key: `barter:${barter.id}`, barter, count })
  }
  for (const row of rows) {
    const reward = row.rewards.find(([id]) => id === itemId)
    if (!reward) continue
    const spent = row.exchange.put.find(([id]) => id === itemId)
    // an exchange that only gives the item back is no way to get it
    if (spent && stackCount(spent) >= stackCount(reward)) continue
    sources.push({ kind: 'circle', key: `circle:${row.key}`, row, count: stackCount(reward), maybe: row.maybe.has(itemId) })
  }
  const order = { craft: 0, barter: 1, circle: 2 } as const
  return sources.sort((a, b) => order[a.kind] - order[b.kind]
    || (a.kind === 'craft' && b.kind === 'craft' ? a.craft.stationName.localeCompare(b.craft.stationName) || a.craft.level - b.craft.level : 0)
    || (a.kind === 'barter' && b.kind === 'barter' ? a.barter.level - b.barter.level || a.barter.traderName.localeCompare(b.barter.traderName) : 0)
    || (a.kind === 'circle' && b.kind === 'circle' ? Number(a.maybe) - Number(b.maybe) : 0))
}

/**
 * Can the player use it now, as far as the app knows: a craft at a module level built, the circle built at all. Trader levels are
 * not kept by the app, so a barter is always open (its level is shown).
 */
export function sourceOpen(source: ItemSource, built: Readonly<Record<string, number>>, circleStationId?: string): boolean {
  if (source.kind === 'craft') return (built[source.craft.stationId] ?? 0) >= source.craft.level
  if (source.kind === 'circle') return !circleStationId || (built[circleStationId] ?? 0) >= 1
  return true
}
