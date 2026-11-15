import type { Response } from 'express'
import type { RaidMode } from '../models/api.js'

/**
 * «Местоположение тиммейтов» and «Передача зарисовок» (owner, 14.11.2026: «каждый из них при нажатии кнопки скриншота
 * появляется у своих тиммейтов на карте… один из них рисует на карте… Когда он нажал галочку, результат сохраняется,
 * отправляется на сервер и передается его тиммейтам моментально»). Per squad and mode, in memory only, like the PC→phone relay
 * (services/liveRelay.ts): each member's latest position (from a game screenshot) for a few minutes, and each member's kept drawing
 * per map for some hours. A restarted server starts empty. Each app sends only what its player turned on in «Настройки отряда».
 *
 * Delivery is long polling (routes/squadLive.ts): a member waits with the version it has and gets the new state the moment a
 * mate publishes. Who may read is decided by the route (a member of the squad, with access); the answer names mates by their
 * squad member id only, never an account id.
 */
export const SQUAD_LIVE_WAIT_MS = 25_000
export const SQUAD_LIVE_TTL_MS = { position: 5 * 60_000, sketch: 12 * 60 * 60_000 } as const
const MAX_WAITING = 5_000
const MAX_WAITING_PER_SLOT = 12
const MAX_SLOTS = 20_000
const MAX_SKETCH_MAPS = 30
const SWEEP_EVERY_MS = 60_000

export interface SquadMatePosition { x: number; y: number; z: number; yaw: number; at: number; map?: string }
export type SquadSketchStroke = { zoom: number; points: Array<[number, number]>; color?: string }
export interface SquadSketch { mapId: string; strokes: SquadSketchStroke[]; at: number }

interface Held<T> { value: T; expires: number }
interface Slot { version: number; positions: Map<string, Held<SquadMatePosition>>; sketches: Map<string, Map<string, Held<SquadSketch>>> }
interface Waiter { res: Response; key: string; render: () => unknown; timer: ReturnType<typeof setTimeout> }

/** A member as the reader sees it: by squad member id. */
export interface SquadLiveMember { accountId: string; memberId: string }

export class SquadLive {
  private readonly slots = new Map<string, Slot>()
  private readonly waiters = new Map<string, Set<Waiter>>()
  private total = 0
  private readonly start: number
  private counter: number
  private sweptAt = 0

  constructor(
    private readonly now: () => number = Date.now,
    private readonly waitMs = SQUAD_LIVE_WAIT_MS,
    private readonly ttl: { position: number; sketch: number } = SQUAD_LIVE_TTL_MS,
  ) {
    this.start = now()
    this.counter = this.start
  }

  get waiting() { return this.total }
  get size() { return this.slots.size }

  private key(squadId: string, mode: RaidMode) { return `${squadId}:${mode}` }

  version(squadId: string, mode: RaidMode) { return this.slots.get(this.key(squadId, mode))?.version ?? this.start }

  /**
   * What `viewer` sees: the other members' fresh positions and drawings. Members who left are not in `members`, so what they
   * sent stays out (and runs out by itself).
   */
  state(squadId: string, mode: RaidMode, viewer: string, members: readonly SquadLiveMember[]) {
    const slot = this.slots.get(this.key(squadId, mode))
    const now = this.now()
    const positions: Array<SquadMatePosition & { memberId: string }> = []
    const sketches: Array<SquadSketch & { memberId: string }> = []
    for (const member of members) {
      if (member.accountId === viewer || !slot) continue
      const position = slot.positions.get(member.accountId)
      if (position && position.expires > now) positions.push({ memberId: member.memberId, ...position.value })
      for (const sketch of slot.sketches.get(member.accountId)?.values() ?? []) {
        if (sketch.expires > now && sketch.value.strokes.length) sketches.push({ memberId: member.memberId, ...sketch.value })
      }
    }
    return { version: slot?.version ?? this.start, positions, sketches }
  }

  setPosition(squadId: string, mode: RaidMode, accountId: string, position: SquadMatePosition) {
    const now = this.now()
    return this.publish(squadId, mode, (slot) => {
      const current = slot.positions.get(accountId)
      // An older screenshot arriving late does not move the marker back.
      if (current && current.expires > now && current.value.at > position.at) return false
      slot.positions.set(accountId, { value: position, expires: now + this.ttl.position })
      return true
    })
  }

  /** A kept drawing of one map; no strokes takes it off the mates' maps. */
  setSketch(squadId: string, mode: RaidMode, accountId: string, mapId: string, strokes: SquadSketchStroke[]) {
    const now = this.now()
    return this.publish(squadId, mode, (slot) => {
      const maps = slot.sketches.get(accountId) ?? new Map<string, Held<SquadSketch>>()
      if (!strokes.length) {
        if (!maps.delete(mapId)) return false
      } else {
        if (!maps.has(mapId) && maps.size >= MAX_SKETCH_MAPS) return false
        maps.set(mapId, { value: { mapId, strokes, at: now }, expires: now + this.ttl.sketch })
      }
      if (maps.size) slot.sketches.set(accountId, maps)
      else slot.sketches.delete(accountId)
      return true
    })
  }

  private publish(squadId: string, mode: RaidMode, change: (slot: Slot) => boolean): number | null {
    this.sweep()
    const key = this.key(squadId, mode)
    let slot = this.slots.get(key)
    if (!slot) {
      if (this.slots.size >= MAX_SLOTS) return null
      slot = { version: this.start, positions: new Map(), sketches: new Map() }
      this.slots.set(key, slot)
    }
    if (!change(slot)) return slot.version
    this.counter += 1
    slot.version = this.counter
    for (const waiter of [...(this.waiters.get(key) ?? [])]) this.answer(waiter)
    return slot.version
  }

  /** Answers now (the version differs, or no room to wait) or when this squad's mode changes / the wait runs out. */
  wait(res: Response, squadId: string, mode: RaidMode, since: number | undefined, render: () => unknown) {
    const key = this.key(squadId, mode)
    const mine = this.waiters.get(key)
    if (since === undefined || since !== this.version(squadId, mode) || this.total >= MAX_WAITING || (mine?.size ?? 0) >= MAX_WAITING_PER_SLOT) {
      res.json(render())
      return
    }
    const waiter: Waiter = { res, key, render, timer: setTimeout(() => this.answer(waiter), this.waitMs) }
    const set = mine ?? new Set<Waiter>()
    set.add(waiter)
    this.waiters.set(key, set)
    this.total += 1
    res.on('close', () => this.drop(waiter))
  }

  private answer(waiter: Waiter) {
    if (!this.drop(waiter)) return
    if (!waiter.res.writableEnded && !waiter.res.destroyed) {
      try { waiter.res.json(waiter.render()) } catch { if (!waiter.res.headersSent) waiter.res.status(404).end() }
    }
  }

  private drop(waiter: Waiter) {
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
      for (const [account, held] of slot.positions) if (held.expires <= now) slot.positions.delete(account)
      for (const [account, maps] of slot.sketches) {
        for (const [mapId, held] of maps) if (held.expires <= now) maps.delete(mapId)
        if (!maps.size) slot.sketches.delete(account)
      }
      if (!slot.positions.size && !slot.sketches.size && !this.waiters.has(key)) this.slots.delete(key)
    }
  }
}
