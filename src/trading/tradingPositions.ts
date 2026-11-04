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
    cached = Array.isArray(rows) ? rows.filter(isPosition).map((row) => ({ ...row, notify: row.notify !== false })) : []
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
  /** The lowest listing that earns the chosen sum, or null when the fee does not allow it. */
  ask: number | null
  ready: boolean
  route?: 'flea' | 'trader'
  /** The listing to make now, 1% under the lowest price; what it leaves and earns. */
  listAt?: number
  fee?: number
  earned?: number
}

/** Can it be sold now for the chosen sum: listed 1% under the lowest price, or to a trader when he pays enough. */
export function positionStatus(position: Pick<TradingPosition, 'paid' | 'plus' | 'base'>, current: number | undefined, trader: number, fee: Omit<FleaFeeOptions, 'count'>): PositionStatus {
  const need = position.paid + position.plus
  const ask = askForNet(position.base, need, fee)
  const listAt = current ? Math.round(current * (1 - UNDERCUT)) : 0
  const listingFee = listAt ? fleaMarketFee(position.base, listAt, fee) : 0
  const netEarned = listAt - listingFee - position.paid
  const flea = ask !== null && listAt >= ask
  const toTrader = trader >= need
  if (flea && (!toTrader || netEarned >= trader - position.paid)) return { ask, ready: true, route: 'flea', listAt, fee: listingFee, earned: netEarned }
  if (toTrader) return { ask, ready: true, route: 'trader', earned: trader - position.paid }
  return { ask, ready: false }
}
