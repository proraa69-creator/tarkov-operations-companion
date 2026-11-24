/**
 * Where an item can be bought and from which level, for «До уровня» of «Отложить квест» on the Overview (owner,
 * 03.11.2026: «если нажимаешь по достижению уровня, у него пишется с какого уровня откроется предмет на барахолке или у
 * торговцев (на каком уровне лояльности или уровне персонажа)»; components/QuestDeferDialog.tsx).
 *
 * From tarkov.dev's files of the mode (json.tarkov.dev `<mode>/items` and `<mode>/barters`, through our server's gateway
 * in the players' app), read only when the window asks and kept per mode — PvP, PvE and Season never mix:
 *   - the flea market: from the market's level (`fleaMarket.minPlayerLevel`, 15) or the item's own when higher
 *     (`minLevelForFlea`: 20–40 for many items); never for a flea-banned item (`types: noFlea`) or a closed flea;
 *   - a trader's offer or barter: at a loyalty level, which needs the character level the trader names for it
 *     (Trader.levelPlayerLevels, from the catalog) and, for some, a quest done first (`taskUnlock`). Traders sell a gun
 *     as its default preset (`properties.defaultPreset`): a gun with no offers of its own takes its preset's.
 */
import { useQuery } from '@tanstack/react-query'
import type { RaidMode, Trader } from '../domain/types'
import { tarkovJson } from '../data/tarkovApi'
import { mirrorMode } from '../data/tarkovDataset'
import { tarkovRecords, unwrapTarkovData } from '../data/tarkovJsonAdapters'

/** The flea market opens at this character level unless the mode's file says otherwise. */
export const FLEA_MARKET_LEVEL = 15

/** One way a trader sells an item: the loyalty level, the quest that opens it, a barter rather than money. */
export interface TraderOffer { traderId: string; loyalty: number; questId?: string; barter?: boolean }

export interface ItemUnlock {
  /** The item's own flea level when above the market's (`minLevelForFlea`). */
  fleaLevel?: number
  noFlea: boolean
  offers: TraderOffer[]
}

export interface ItemUnlocks {
  mode: RaidMode
  flea: { enabled: boolean; level: number }
  items: ReadonlyMap<string, ItemUnlock>
}

type Json = Record<string, unknown>
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const level = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.round(value) : undefined

/** The items file and the barters of one mode → what opens each item. Pure: tested against the files' shape. */
export function parseItemUnlocks(itemsFile: unknown, bartersFile: unknown, mode: RaidMode): ItemUnlocks {
  const root = object(unwrapTarkovData(itemsFile))
  const market = object(root.fleaMarket)
  const items = new Map<string, ItemUnlock>()
  const offer = (row: Json, barter: boolean): TraderOffer | undefined => {
    const traderId = text(row.trader)
    if (!traderId) return undefined
    const questId = text(row.taskUnlock) || text(object(row.taskUnlock).id)
    return { traderId, loyalty: level(row.minTraderLevel) ?? 1, ...(questId ? { questId } : {}), ...(barter ? { barter } : {}) }
  }
  const presets: Array<[string, string]> = []
  for (const row of tarkovRecords(root.items)) {
    const id = text(row.id)
    if (!id) continue
    const types = Array.isArray(row.types) ? row.types : []
    const own = level(row.minLevelForFlea)
    items.set(id, {
      ...(own ? { fleaLevel: own } : {}),
      noFlea: types.includes('noFlea'),
      offers: (Array.isArray(row.buyFromTrader) ? row.buyFromTrader : []).flatMap((entry) => offer(object(entry), false) ?? []),
    })
    const preset = object(row.properties).defaultPreset
    const presetId = text(preset) || text(object(preset).id)
    if (presetId && presetId !== id) presets.push([id, presetId])
  }
  for (const row of tarkovRecords(bartersFile, 'barters')) {
    const item = items.get(text(object(row.offeredItem).item))
    const barter = offer(row, true)
    if (item && barter) item.offers.push(barter)
  }
  for (const [id, presetId] of presets) {
    const gun = items.get(id)
    const preset = items.get(presetId)
    if (gun && !gun.offers.length && preset?.offers.length) gun.offers = [...preset.offers]
  }
  return { mode, flea: { enabled: market.enabled !== false, level: level(market.minPlayerLevel) ?? FLEA_MARKET_LEVEL }, items }
}

export async function fetchItemUnlocks(mode: RaidMode): Promise<ItemUnlocks> {
  const upstream = mirrorMode(mode)
  // The barters only add ways: without them the offers for money still say where the item is.
  const [items, barters] = await Promise.all([tarkovJson(`${upstream}/items`), tarkovJson(`${upstream}/barters`).catch(() => undefined)])
  return parseItemUnlocks(items, barters, mode)
}

/** Loaded when the window asks (`enabled`), kept for half an hour per mode. */
export function useItemUnlocks(mode: RaidMode, enabled = true) {
  return useQuery({
    queryKey: ['raidos-item-unlocks', mode],
    queryFn: () => fetchItemUnlocks(mode),
    enabled,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

/** One place the item opens, with the character level it needs (unknown for a trader the catalog has no levels of). */
export interface UnlockSource {
  key: string
  kind: 'flea' | 'trader'
  level?: number
  trader?: Pick<Trader, 'id' | 'name'>
  loyalty?: number
  questId?: string
  barter?: boolean
}

/**
 * Where the item opens, lowest level first: the flea market (its level, the item's own when higher), then each trader's
 * cheapest loyalty level — for money before a barter, the one with no quest before one after a quest. Nothing for a
 * flea the mode has closed or an item it bans; a trader the catalog does not know is left out.
 */
export function unlockSources(itemId: string, unlocks: ItemUnlocks, traders: readonly Trader[]): UnlockSource[] {
  const item = unlocks.items.get(itemId)
  if (!item) return []
  const sources: UnlockSource[] = []
  if (unlocks.flea.enabled && !item.noFlea) sources.push({ key: 'flea', kind: 'flea', level: Math.max(unlocks.flea.level, item.fleaLevel ?? 0) })
  const byId = new Map(traders.map((trader) => [trader.id, trader]))
  const best = new Map<string, TraderOffer>()
  const rank = (offer: TraderOffer) => offer.loyalty * 4 + (offer.questId ? 2 : 0) + (offer.barter ? 1 : 0)
  for (const offer of item.offers) {
    if (!byId.has(offer.traderId)) continue
    const known = best.get(offer.traderId)
    if (!known || rank(offer) < rank(known)) best.set(offer.traderId, offer)
  }
  for (const [traderId, offer] of best) {
    const trader = byId.get(traderId)!
    const needed = trader.levelPlayerLevels?.[offer.loyalty - 1]
    sources.push({
      key: `trader:${traderId}`, kind: 'trader', trader: { id: trader.id, name: trader.name }, loyalty: offer.loyalty,
      ...(needed !== undefined ? { level: Math.max(1, needed) } : {}), ...(offer.questId ? { questId: offer.questId } : {}), ...(offer.barter ? { barter: true } : {}),
    })
  }
  return sources.sort((a, b) => (a.level ?? Infinity) - (b.level ?? Infinity) || (a.kind === 'flea' ? -1 : b.kind === 'flea' ? 1 : 0))
}
