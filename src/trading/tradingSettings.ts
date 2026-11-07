import { useSyncExternalStore } from 'react'

/**
 * «Торговля» → notifications: kept on this device, shared by all modes (as the restock notifications). Off until the player turns
 * them on with the button in the block (owner, 06.11.2026, on a player's proposal, №67: «По умолчанию уведомления выключены»).
 */
const KEY = 'raidos-trading-notify-v1'
const SEEN_KEY = 'raidos-trading-notified-v1'
const EVENT = 'raidos-trading-settings-changed'
/** The account's other devices keep this too: sync/playerStateStores.ts reads and writes it in this format. */
export const TRADING_SETTINGS_SYNC = { key: KEY, event: EVENT } as const

export interface TradingSettings { enabled: boolean; minProfit: number }
export const TRADING_PROFIT_STEPS = [5_000, 10_000, 25_000, 50_000, 100_000] as const
export const DEFAULT_TRADING_SETTINGS: TradingSettings = { enabled: false, minProfit: 25_000 }

export function sanitizeTradingSettings(value: unknown): TradingSettings {
  const row = value && typeof value === 'object' ? value as Partial<TradingSettings> : {}
  return {
    enabled: row.enabled === true,
    minProfit: TRADING_PROFIT_STEPS.includes(row.minProfit as typeof TRADING_PROFIT_STEPS[number]) ? row.minProfit as number : DEFAULT_TRADING_SETTINGS.minProfit,
  }
}

let cachedRaw: string | null | undefined
let cached = DEFAULT_TRADING_SETTINGS

export function readTradingSettings(): TradingSettings {
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) } catch { /* storage unavailable */ }
  if (raw === cachedRaw) return cached
  cachedRaw = raw
  try { cached = sanitizeTradingSettings(raw ? JSON.parse(raw) : undefined) } catch { cached = DEFAULT_TRADING_SETTINGS }
  return cached
}

export function writeTradingSettings(patch: Partial<TradingSettings>) {
  try { localStorage.setItem(KEY, JSON.stringify(sanitizeTradingSettings({ ...readTradingSettings(), ...patch }))) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
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

export const useTradingSettings = () => useSyncExternalStore(subscribe, readTradingSettings, () => DEFAULT_TRADING_SETTINGS)

/** One dip notifies once: an item's signal of one kind in one mode stays quiet this long. */
export const NOTIFY_AGAIN_MS = 12 * 60 * 60_000

export function readNotifiedSignals(now = Date.now()): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, unknown>
    return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && now - entry[1] < NOTIFY_AGAIN_MS))
  } catch { return {} }
}

export function rememberNotifiedSignals(seen: Record<string, number>) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)) } catch { /* storage unavailable */ }
}
