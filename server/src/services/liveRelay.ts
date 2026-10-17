import type { Response } from 'express'
import type { RaidMode } from '../models/api.js'
import type { StoredPosition } from './userDataStore.js'

/**
 * «Моментальное местоположение в мобильном приложении и показ цены тоже моментальный» (owner, 15.10.2026): the PC app
 * publishes the player's position (from each game screenshot) and the item it just recognised; the phone of the same
 * account receives them within about a second. Nothing is written anywhere: only the latest value per account and mode
 * stays in memory, for a short while (`LIVE_TTL_MS`). A restarted server starts empty.
 *
 * Delivery is long polling, like /v1/me/social-events and /v1/map-updates: the phone waits on GET /v1/live/:mode with
 * the version it has, and gets the new state the moment the PC publishes (routes/live.ts).
 */
export const LIVE_WAIT_MS = 25_000
export const LIVE_TTL_MS = { position: 5 * 60_000, item: 2 * 60_000 } as const
const MAX_WAITING = 5_000
const MAX_WAITING_PER_SLOT = 4
const MAX_SLOTS = 50_000
const SWEEP_EVERY_MS = 60_000

export type LivePosition = StoredPosition

export interface LiveQuestNeed { questId: string; name: string; trader: string; count: number; kappa: boolean; purpose: string }

/** The item card as the PC shows it on its Maps page (src/overlay/types.ts ItemOverlayInfo, without diagnostics). */
export interface LiveItem {
  itemId: string
  name: string
  shortName?: string
  iconUrl?: string
  weaponPreset?: boolean
  fleaPrice?: number
  fleaAverage?: boolean
  bestTrader?: { name: string; price: number }
  quests: LiveQuestNeed[]
  kappa: boolean
  collector: boolean
  mate?: boolean
  mateNames?: string[]
  /** When the PC recognised it (epoch ms, clamped to the server time). */
  at: number
  /** Server receive time, ISO 8601. */
  receivedAt: string
}

export interface LiveState { version: number; position: LivePosition | null; item: LiveItem | null }

interface Held<T> { value: T; expires: number }
interface Slot { version: number; position?: Held<LivePosition>; item?: Held<LiveItem> }
interface Waiter { res: Response; key: string; timer: ReturnType<typeof setTimeout> }

export class LiveRelay {
  private readonly slots = new Map<string, Slot>()
  private readonly waiters = new Map<string, Set<Waiter>>()
  private total = 0
  /** The version of a slot nobody published to: the relay's start, the same for every account. */
  private readonly start: number
  private counter: number
  private sweptAt = 0

  constructor(
    private readonly now: () => number = Date.now,
    private readonly waitMs = LIVE_WAIT_MS,
    private readonly ttl: { position: number; item: number } = LIVE_TTL_MS,
  ) {
    // Versions start at the start time: an app holding a version from before a restart is answered at once.
    this.start = now()
    this.counter = this.start
  }

  get waiting() { return this.total }
  get size() { return this.slots.size }

  private key(accountId: string, mode: RaidMode) { return `${accountId}:${mode}` }

  private fresh<T>(held: Held<T> | undefined, now: number) { return held && held.expires > now ? held.value : null }

  /** The latest position and item of this account and mode that are still fresh. */
  state(accountId: string, mode: RaidMode): LiveState {
    const slot = this.slots.get(this.key(accountId, mode))
    const now = this.now()
    return { version: slot?.version ?? this.start, position: this.fresh(slot?.position, now), item: this.fresh(slot?.item, now) }
  }

  position(accountId: string, mode: RaidMode) { return this.state(accountId, mode).position }

  setPosition(accountId: string, mode: RaidMode, position: Omit<LivePosition, 'receivedAt'>) {
    const now = this.now()
    const value: LivePosition = { ...position, receivedAt: new Date(now).toISOString() }
    return this.publish(accountId, mode, (slot) => {
      // An older screenshot arriving late does not move the dot back.
      const current = this.fresh(slot.position, now)
      if (current && current.at > value.at) return false
      slot.position = { value, expires: now + this.ttl.position }
      return true
    })
  }

  setItem(accountId: string, mode: RaidMode, item: Omit<LiveItem, 'receivedAt'>) {
    const now = this.now()
    const value: LiveItem = { ...item, receivedAt: new Date(now).toISOString() }
    return this.publish(accountId, mode, (slot) => {
      slot.item = { value, expires: now + this.ttl.item }
      return true
    })
  }

  private publish(accountId: string, mode: RaidMode, change: (slot: Slot) => boolean) {
    this.sweep()
    const key = this.key(accountId, mode)
    let slot = this.slots.get(key)
    if (!slot) {
      if (this.slots.size >= MAX_SLOTS) return null
      slot = { version: this.start }
      this.slots.set(key, slot)
    }
    if (!change(slot)) return slot.version
    this.counter += 1
    slot.version = this.counter
    for (const waiter of [...(this.waiters.get(key) ?? [])]) this.answer(waiter)
    return slot.version
  }

  /** Answers now (the version differs, or no room to wait) or when this slot changes / the wait runs out. */
  wait(res: Response, accountId: string, mode: RaidMode, since: number | undefined) {
    const key = this.key(accountId, mode)
    const mine = this.waiters.get(key)
    const state = this.state(accountId, mode)
    if (since === undefined || since !== state.version || this.total >= MAX_WAITING || (mine?.size ?? 0) >= MAX_WAITING_PER_SLOT) {
      res.json(state)
      return
    }
    const waiter: Waiter = { res, key, timer: setTimeout(() => this.answer(waiter), this.waitMs) }
    const set = mine ?? new Set<Waiter>()
    set.add(waiter)
    this.waiters.set(key, set)
    this.total += 1
    res.on('close', () => this.forget(waiter))
  }

  private answer(waiter: Waiter) {
    if (!this.forget(waiter)) return
    const [accountId, mode] = splitKey(waiter.key)
    if (!waiter.res.writableEnded && !waiter.res.destroyed) waiter.res.json(this.state(accountId, mode))
  }

  private forget(waiter: Waiter) {
    const set = this.waiters.get(waiter.key)
    if (!set?.delete(waiter)) return false
    if (!set.size) this.waiters.delete(waiter.key)
    this.total -= 1
    clearTimeout(waiter.timer)
    return true
  }

  /** Expired values go; a slot with nothing left and nobody waiting goes too. */
  sweep(force = false) {
    const now = this.now()
    if (!force && now - this.sweptAt < SWEEP_EVERY_MS) return
    this.sweptAt = now
    for (const [key, slot] of this.slots) {
      if (slot.position && slot.position.expires <= now) delete slot.position
      if (slot.item && slot.item.expires <= now) delete slot.item
      if (!slot.position && !slot.item && !this.waiters.has(key)) this.slots.delete(key)
    }
  }
}

function splitKey(key: string): [string, RaidMode] {
  const index = key.lastIndexOf(':')
  return [key.slice(0, index), key.slice(index + 1) as RaidMode]
}
