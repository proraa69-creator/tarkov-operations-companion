import { useSyncExternalStore } from 'react'
import type { Item, RaidMode } from '../domain/types'
import { conditionVaries } from '../domain/trading'
import type { FleaReading } from '../import/fleaReading'
import { DOLLARS_ID, EUROS_ID, fleaRates, fleaSightings, isTraderRow, keyAllUses, type FleaRates, type FleaRow, type FleaSighting } from '../import/fleaScreen'
import type { LivePrices } from './livePrices'
import { dataRoute, gatewayRequest, tarkovGraphql } from './tarkovApi'
import type { MinutePrice } from './tarkovJsonAdapters'

/**
 * The flea prices the player's own screen showed (docs/flea-prices-from-players.md; owner, 18.11.2026: «приоритет цены
 * будет с экрана пользователя»). The main process reads the list (src/import/fleaReading.ts); here its names become
 * catalog items, its mode is the mode the game is in by its logs (the owner: «у нас приложение это отслеживает»), its
 * prices go to roubles at the game's rate, and each item's lowest player's price stands in this app over the server's
 * for PLAYER_PRICE_MS — until a fresher one comes. Kept while the app runs, and sent to our server
 * (POST /v1/data/prices/:mode/sightings, server/src/services/playerPrices.ts), which lays the ones it accepts over the
 * minute prices of every app. Only the mode, the item, the price in roubles and when it was seen: no picture, no name.
 */
export const PLAYER_PRICE_MS = 30 * 60_000
const MINUTE_MS = 60_000

export interface ScreenPrice { price: number; at: number; listed?: FleaSighting['listed'] }

/** What turns the read rows into items: the item card's name matcher and the catalog (src/components/ExperimentalBridge.tsx). */
export interface FleaCatalog {
  /** The item a name line names, or null when it names none for sure (one name: no loose fallback). */
  match(name: string): Item | null
}

const prices: Record<RaidMode, Map<string, ScreenPrice>> = { pvp: new Map(), pve: new Map(), seasonal: new Map() }
const listeners = new Set<() => void>()
let version = 0
let catalog: FleaCatalog | null = null

export function setFleaCatalog(next: FleaCatalog | null) {
  catalog = next
}

/**
 * Items whose copies differ (docs/trading.md): their lowest price may be a worn copy's. The app's catalog has the kinds
 * (tarkov.dev `types`: guns, armor, helmets…) and its own categories, not the properties the server judges by. Keys are
 * not among them here: a key counts when the offer has all its uses (keyAllUses).
 */
export function copiesDiffer(item: Item) {
  if (isKey(item)) return false
  return conditionVaries(item) || item.category === 'Оружие' || item.category === 'Броня'
}

const isKey = (item: Item) => item.category === 'Ключ' || Boolean(item.types?.includes('keys'))

/** Left out of the prices: copies that differ, a key offered with some of its uses gone («8/10»). */
export function leaveOut(item: Item, info: string) {
  return isKey(item) ? !keyAllUses(info, item.keyUses) : copiesDiffer(item)
}

export type FleaReadingOutcome =
  | { applied: FleaSighting[]; stoppedAt: ReturnType<typeof fleaSightings>['stoppedAt'] }
  | { skipped: 'no-catalog' | 'mode-unknown' | 'other-mode' }

/**
 * A list read on the player's screen, for the mode the game is in (`mode`: from its logs; null while they have not named
 * it — then nothing is taken). A version line naming another mode keeps the reading out.
 */
export async function noteFleaReading(reading: FleaReading, mode: RaidMode | null, ratesFor: (mode: RaidMode) => Promise<FleaRates> = fleaRatesOf, send: SightingsSender = sendThroughGateway): Promise<FleaReadingOutcome> {
  if (!catalog) return { skipped: 'no-catalog' }
  if (!mode) return { skipped: 'mode-unknown' }
  if (reading.labelMode && reading.labelMode !== mode) return { skipped: 'other-mode' }
  const items = new Map<string, Item>()
  const rows: FleaRow[] = reading.rows.map((row) => {
    const item = row.name && !isTraderRow(row.seller, row.info, reading.language) ? catalog!.match(row.name) : null
    if (item) items.set(item.id, item)
    return { price: row.price, seller: row.seller, info: row.info, itemId: item?.id ?? null }
  })
  // The rates only when a row is in dollars or euros.
  const foreign = reading.rows.some((row) => row.price.kind === 'price' && (row.price.currency === '$' || row.price.currency === '€'))
  const result = fleaSightings(rows, (id, info) => leaveOut(items.get(id)!, info), foreign ? await ratesFor(mode) : {}, reading.language)
  const known = prices[mode]
  for (const sighting of result.sightings) {
    const before = known.get(sighting.itemId)
    if (before && before.at > reading.at) continue
    known.set(sighting.itemId, { price: sighting.price, at: reading.at, ...(sighting.listed ? { listed: sighting.listed } : {}) })
  }
  if (result.sightings.length) {
    version += 1
    for (const listener of listeners) listener()
    void sendSightings(mode, result.sightings, reading.at, send)
  }
  return { applied: result.sightings, stoppedAt: result.stoppedAt }
}

export type SightingsSender = (mode: RaidMode, sightings: Array<{ itemId: string; price: number; seenAt: number }>) => Promise<unknown>

/** The same price of an item is not sent again within this (the server leaves such a repeat out anyway). */
export const RESEND_MS = 2 * 60_000
const sent = new Map<string, { price: number; at: number }>()

/** Our server only, in the players' app (through the gateway with the account's session): never in development. */
const sendThroughGateway: SightingsSender = (mode, sightings) => dataRoute() === 'gateway'
  ? gatewayRequest('POST', `/v1/data/prices/${mode}/sightings`, { sightings })
  : Promise.resolve(null)

async function sendSightings(mode: RaidMode, sightings: FleaSighting[], seenAt: number, send: SightingsSender) {
  const fresh = sightings.filter((sighting) => {
    const key = `${mode}:${sighting.itemId}`
    const before = sent.get(key)
    if (before && before.price === sighting.price && seenAt - before.at < RESEND_MS) return false
    sent.set(key, { price: sighting.price, at: seenAt })
    return true
  })
  if (!fresh.length) return
  // A server that does not answer loses nothing here: the price already stands in this app.
  await send(mode, fresh.map((sighting) => ({ itemId: sighting.itemId, price: sighting.price, seenAt }))).catch(() => null)
}

/** tarkov.dev has no Season of its own: Season trades as PvP there (src/data/economyApi.ts). */
const GAME_MODE: Record<RaidMode, 'regular' | 'pve'> = { pvp: 'regular', seasonal: 'regular', pve: 'pve' }
const RATES_MS = 60 * 60_000
const rates = new Map<RaidMode, { at: number; value: Promise<FleaRates> }>()

/**
 * The game's rates of a mode (fleaRates: what Peacekeeper and Skier ask for a dollar and a euro), asked for once an hour
 * through our server's data gateway (two items, cached there for every player). None when it does not answer: the offers
 * in dollars and euros then give no price.
 */
export function fleaRatesOf(mode: RaidMode, now = Date.now(), ask: typeof tarkovGraphql = tarkovGraphql): Promise<FleaRates> {
  const known = rates.get(mode)
  if (known && now - known.at < RATES_MS) return known.value
  const query = `{ items(ids: ["${DOLLARS_ID}", "${EUROS_ID}"], gameMode: ${GAME_MODE[mode]}) { id buyFor { vendor { normalizedName } priceRUB } } }`
  const value = ask<{ items?: Parameters<typeof fleaRates>[0] }>(query)
    .then((answer) => fleaRates(answer.data?.items ?? []))
    .catch((): FleaRates => ({}))
  value.then((found) => { if (!found['€'] && !found['$']) rates.delete(mode) }).catch(() => {})
  rates.set(mode, { at: now, value })
  return value
}

/** This mode's prices from the player's screen, younger than PLAYER_PRICE_MS. */
export function screenPrices(mode: RaidMode, now = Date.now()): ReadonlyMap<string, ScreenPrice> {
  const fresh = new Map<string, ScreenPrice>()
  for (const [id, entry] of prices[mode]) if (now - entry.at < PLAYER_PRICE_MS) fresh.set(id, entry)
  return fresh
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }

/** A number that changes with every new price from the screen (to recompute what depends on them). */
export function useScreenPricesVersion() {
  return useSyncExternalStore(subscribe, () => version, () => version)
}

/**
 * The server's minute prices with the player's own over them: for PLAYER_PRICE_MS a price seen on the screen is the
 * item's lowest offer, whatever the server says meanwhile (owner: «приоритет цены будет с экрана пользователя»). Null
 * stays null when nothing was seen.
 */
export function withScreenPrices(live: LivePrices | null, mode: RaidMode, now = Date.now()): LivePrices | null {
  const seen = screenPrices(mode, now)
  if (!seen.size) return live
  const items = new Map<string, MinutePrice>(live?.items ?? [])
  let changed = false
  for (const [id, entry] of seen) {
    const server = items.get(id)
    const minute = Math.floor(entry.at / MINUTE_MS)
    if (server?.noFlea) continue
    items.set(id, { ...server, lastLowPrice: entry.price, at: minute })
    changed = true
  }
  return changed ? { ...live, items } : live
}

/** For the tests: start empty. */
export function clearScreenPrices() {
  for (const mode of Object.keys(prices) as RaidMode[]) prices[mode].clear()
  rates.clear()
  sent.clear()
  version += 1
  for (const listener of listeners) listener()
}
