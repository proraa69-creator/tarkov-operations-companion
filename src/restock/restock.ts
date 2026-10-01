/**
 * Trader restock timers and notification scheduling (pure functions, see restock.test.ts).
 * Reset times come from tarkov.dev `traders { resetTime }` (ISO date) for the selected game mode.
 */

export interface TraderReset {
  id: string
  name: string
  normalizedName?: string
  imageUrl?: string
  /** ISO timestamp of the next restock; undefined when tarkov.dev has none for this trader. */
  resetTime?: string
}

export interface RestockSettings {
  /** Notifications on/off. */
  enabled: boolean
  /** Minutes before the restock to notify. */
  leadMinutes: number
  /** Traders the player wants to hear about (tarkov.dev ids). */
  traderIds: string[]
}

/** The reset entry for a catalog trader: same tarkov.dev id, or (demo catalog) the normalized name / name. */
export function findReset(resets: TraderReset[] | undefined, trader: { id: string; name: string }) {
  return resets?.find((entry) => entry.id === trader.id || entry.normalizedName === trader.id || entry.name === trader.name)
}

export const LEAD_MINUTE_CHOICES = [1, 2, 3, 5, 10, 15] as const
export const DEFAULT_RESTOCK_SETTINGS: RestockSettings = { enabled: false, leadMinutes: 3, traderIds: [] }

/** Validates stored settings; anything malformed falls back to the defaults. */
export function sanitizeRestockSettings(value: unknown): RestockSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof RestockSettings, unknown>>
  const lead = typeof raw.leadMinutes === 'number' && Number.isFinite(raw.leadMinutes) ? Math.round(raw.leadMinutes) : DEFAULT_RESTOCK_SETTINGS.leadMinutes
  return {
    enabled: raw.enabled === true,
    leadMinutes: Math.min(60, Math.max(1, lead)),
    traderIds: Array.isArray(raw.traderIds) ? [...new Set(raw.traderIds.filter((id): id is string => typeof id === 'string' && id.length > 0))] : [],
  }
}

export function resetAt(trader: Pick<TraderReset, 'resetTime'>): number | undefined {
  if (!trader.resetTime) return undefined
  const time = Date.parse(trader.resetTime)
  return Number.isFinite(time) ? time : undefined
}

/** Milliseconds until the restock; negative once it has passed (tarkov.dev has not published the next one yet). */
export function msUntilRestock(trader: Pick<TraderReset, 'resetTime'>, now: number): number | undefined {
  const time = resetAt(trader)
  return time === undefined ? undefined : time - now
}

/** H:MM:SS (or M:SS under an hour); language-neutral. */
export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/** The trader with the earliest restock still in the future (optionally only among `traderIds`). */
export function nextRestock(traders: TraderReset[], now: number, traderIds?: string[]) {
  let best: { trader: TraderReset; at: number } | undefined
  for (const trader of traders) {
    if (traderIds?.length && !traderIds.includes(trader.id)) continue
    const at = resetAt(trader)
    if (at === undefined || at <= now) continue
    if (!best || at < best.at) best = { trader, at }
  }
  return best
}

export interface DueNotification {
  /** Unique per trader and restock, so one restock notifies once. */
  key: string
  trader: TraderReset
  at: number
  minutesLeft: number
}

export const notificationKey = (traderId: string, at: number) => `${traderId}@${at}`

/**
 * Notifications that should fire now: selected traders whose restock is within the lead time and still ahead,
 * not already notified. A restock that passed while the app was closed is skipped (no late spam).
 */
export function dueNotifications(traders: TraderReset[], settings: RestockSettings, now: number, notified: ReadonlySet<string>): DueNotification[] {
  if (!settings.enabled || !settings.traderIds.length) return []
  const lead = settings.leadMinutes * 60_000
  return traders.flatMap((trader) => {
    if (!settings.traderIds.includes(trader.id)) return []
    const at = resetAt(trader)
    if (at === undefined || at <= now || at - lead > now) return []
    const key = notificationKey(trader.id, at)
    if (notified.has(key)) return []
    return [{ key, trader, at, minutesLeft: Math.max(1, Math.ceil((at - now) / 60_000)) }]
  })
}

/** When the next notification window opens (ms from now), for scheduling a timer; undefined if none is pending. */
export function nextNotificationDelay(traders: TraderReset[], settings: RestockSettings, now: number, notified: ReadonlySet<string>) {
  if (!settings.enabled) return undefined
  const lead = settings.leadMinutes * 60_000
  let delay: number | undefined
  for (const trader of traders) {
    if (!settings.traderIds.includes(trader.id)) continue
    const at = resetAt(trader)
    if (at === undefined || at <= now || notified.has(notificationKey(trader.id, at))) continue
    const wait = Math.max(0, at - lead - now)
    if (delay === undefined || wait < delay) delay = wait
  }
  return delay
}

/** Keeps only notification keys for restocks newer than a day ago (the stored set never grows without bound). */
export function pruneNotified(keys: Iterable<string>, now: number) {
  return [...keys].filter((key) => {
    const at = Number(key.split('@')[1])
    return Number.isFinite(at) && at > now - 24 * 60 * 60_000
  })
}
