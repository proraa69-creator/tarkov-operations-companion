import { useSyncExternalStore } from 'react'
import { fleaMarketFee, type FleaFeeOptions } from '../domain/fleaFee'
import { askForNet, UNDERCUT } from '../domain/trading'
import type { RaidMode } from '../domain/types'

/**
 * «Купил» in «Торговля» (owner, 05.11.2026: «нажимаешь купил, можно выбрать отправить уведомление о старте продажи, и он
 * будет давать сигнал в зависимости от выбранной суммы плюса, когда можно продавать и по какой минимальной цене»). What the
 * player bought, for how much, and what they want to earn: kept on this device, per mode, one per item.
 */
const KEY = 'raidos-trading-positions-v1'
const EVENT = 'raidos-trading-positions-changed'

export interface TradingPosition {
  mode: RaidMode
  itemId: string
  paid: number
  plus: number
  notify: boolean
  boughtAt: number
  /** The item's base price: the fee needs it, and the item may leave the statistics while it is held. */
  base: number
  /** A message also when the lowest price reaches this, say close to the week's high (owner: «когда он перешагнет порог»). */
  alertPrice?: number
}

/** The sums to choose from; «more» opens a field of the player's own, above the last of these. */
export const PLUS_STEPS = [0, 10_000, 25_000, 50_000, 100_000] as const

const isPosition = (value: unknown): value is TradingPosition => {
  const row = (value && typeof value === 'object' ? value : {}) as Partial<TradingPosition>
  return (row.mode === 'pvp' || row.mode === 'pve' || row.mode === 'seasonal') && typeof row.itemId === 'string'
    && typeof row.paid === 'number' && row.paid > 0 && typeof row.plus === 'number' && row.plus >= 0 && typeof row.base === 'number' && row.base > 0
}

let cachedRaw: string | null | undefined
let cached: TradingPosition[] = []

export function readPositions(): TradingPosition[] {
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) } catch { /* storage unavailable */ }
  if (raw === cachedRaw) return cached
  cachedRaw = raw
  try {
    const rows = raw ? JSON.parse(raw) as unknown : []
    cached = Array.isArray(rows) ? rows.filter(isPosition).map((row) => {
      const { alertPrice, ...rest } = row
      return { ...rest, notify: row.notify !== false, ...(typeof alertPrice === 'number' && alertPrice > 0 ? { alertPrice } : {}) }
    }) : []
  } catch { cached = [] }
  return cached
}

function write(rows: TradingPosition[]) {
  try { localStorage.setItem(KEY, JSON.stringify(rows)) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

export function savePosition(position: TradingPosition) {
  write([...readPositions().filter((row) => row.mode !== position.mode || row.itemId !== position.itemId), position])
}

export function removePosition(mode: RaidMode, itemId: string) {
  write(readPositions().filter((row) => row.mode !== mode || row.itemId !== itemId))
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

const NONE: TradingPosition[] = []
export const useAllPositions = () => useSyncExternalStore(subscribe, readPositions, () => NONE)

export interface PositionStatus {
  /** The lowest listing that loses nothing after the fee, and its fee. */
  zeroAsk: number | null
  zeroFee: number
  /** The lowest listing that earns the chosen sum, or null when the fee does not allow it, and its fee. */
  ask: number | null
  askFee: number
  /** Sold now, 1% under the lowest price: the listing, its fee and what it earns or loses. */
  nowAsk?: number
  nowFee?: number
  nowPlus?: number
  /** The lowest price has reached the player's own threshold. */
  priceReached: boolean
  ready: boolean
  route?: 'flea' | 'trader'
  /** The listing to make now, 1% under the lowest price; what it leaves and earns. */
  listAt?: number
  fee?: number
  earned?: number
}

/** Can it be sold now for the chosen sum: listed 1% under the lowest price, or to a trader when he pays enough. */
export function positionStatus(position: Pick<TradingPosition, 'paid' | 'plus' | 'base' | 'alertPrice'>, current: number | undefined, trader: number, fee: Omit<FleaFeeOptions, 'count'>): PositionStatus {
  const need = position.paid + position.plus
  const ask = askForNet(position.base, need, fee)
  const zeroAsk = askForNet(position.base, position.paid, fee)
  const listAt = current ? Math.round(current * (1 - UNDERCUT)) : 0
  const listingFee = listAt ? fleaMarketFee(position.base, listAt, fee) : 0
  const netEarned = listAt - listingFee - position.paid
  const flea = ask !== null && listAt > 0 && listAt >= ask
  const toTrader = trader >= need
  const base = {
    zeroAsk,
    zeroFee: zeroAsk === null ? 0 : fleaMarketFee(position.base, zeroAsk, fee),
    ask,
    askFee: ask === null ? 0 : fleaMarketFee(position.base, ask, fee),
    ...(listAt ? { nowAsk: listAt, nowFee: listingFee, nowPlus: netEarned } : {}),
    priceReached: Boolean(position.alertPrice && current && current >= position.alertPrice),
  }
  if (flea && (!toTrader || netEarned >= trader - position.paid)) return { ...base, ready: true, route: 'flea', listAt, fee: listingFee, earned: netEarned }
  if (toTrader) return { ...base, ready: true, route: 'trader', earned: trader - position.paid }
  return { ...base, ready: false }
}
