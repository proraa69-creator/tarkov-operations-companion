import type { Response } from 'express'

/**
 * «Пресеты экрана» from the phone (owner, 31.10.2026: «добавь функцию пресетов на телефонную версию, при настройке на
 * телефоне, в режиме онлайн моментально меняются настройки пресетов на пк. и можно выбирать пресеты с телефона…
 * включать и выключать их»). In memory only, per account, like the live relay (services/liveRelay.ts):
 *
 * - the PC app publishes its screen-tuning state (presets, the chosen one, on / off) — the phone waits for a new version;
 * - the phone sends commands (choose, on / off, a tuned preset) — the PC waits for them and applies them at once
 *   (src/screen/ScreenRemote.tsx), then publishes its state again.
 *
 * Commands live a minute and at most COMMANDS_KEPT per account: a PC that comes back later does not replay old taps.
 */
export const SCREEN_WAIT_MS = 25_000
export const SCREEN_STATE_TTL_MS = 10 * 60_000
const COMMAND_TTL_MS = 60_000
const COMMANDS_KEPT = 30
const MAX_ACCOUNTS = 20_000
const WAITERS_PER_SLOT = 4
const MAX_WAITERS = 5_000

export type ScreenCommand =
  | { type: 'select'; activeId: string }
  | { type: 'enabled'; enabled: boolean }
  | { type: 'save'; preset: Record<string, unknown> }
  | { type: 'scan'; start: boolean }

interface Waiter { res: Response; timer: NodeJS.Timeout; done: boolean }
interface Slot {
  state: unknown
  stateAt: number
  version: number
  commands: Array<{ id: number; at: number; command: ScreenCommand }>
  lastId: number
  phone: Set<Waiter>
  pc: Map<Waiter, number>
}

export class ScreenRelay {
  private readonly slots = new Map<string, Slot>()
  private waiters = 0
  constructor(private readonly now: () => number = Date.now, private readonly waitMs = SCREEN_WAIT_MS) {}

  private slot(account: string, create: boolean) {
    let slot = this.slots.get(account)
    if (!slot && create) {
      if (this.slots.size >= MAX_ACCOUNTS) this.sweep()
      if (this.slots.size >= MAX_ACCOUNTS) return undefined
      slot = { state: null, stateAt: 0, version: 1, commands: [], lastId: 0, phone: new Set(), pc: new Map() }
      this.slots.set(account, slot)
    }
    return slot
  }

  private sweep() {
    const now = this.now()
    for (const [account, slot] of this.slots) {
      if (!slot.phone.size && !slot.pc.size && now - slot.stateAt > SCREEN_STATE_TTL_MS && !slot.commands.some((entry) => now - entry.at < COMMAND_TTL_MS)) this.slots.delete(account)
    }
  }

  private freshState(slot: Slot) {
    return slot.state !== null && this.now() - slot.stateAt < SCREEN_STATE_TTL_MS ? { state: slot.state, at: slot.stateAt } : null
  }

  private pending(slot: Slot, since: number) {
    const now = this.now()
    slot.commands = slot.commands.filter((entry) => now - entry.at < COMMAND_TTL_MS)
    return slot.commands.filter((entry) => entry.id > since).map(({ id, command }) => ({ id, ...command }))
  }

  /** `remove` takes the waiter off its slot; a closed connection is released without an answer. */
  private hold(res: Response, onTimeout: () => void, remove: (waiter: Waiter) => void) {
    const waiter: Waiter = { res, done: false, timer: setTimeout(() => { if (!waiter.done) { waiter.done = true; remove(waiter); this.release(waiter); onTimeout() } }, this.waitMs) }
    waiter.timer.unref?.()
    this.waiters += 1
    res.on('close', () => { if (!waiter.done) { waiter.done = true; remove(waiter); this.release(waiter) } })
    return waiter
  }

  private release(waiter: Waiter) {
    clearTimeout(waiter.timer)
    this.waiters = Math.max(0, this.waiters - 1)
  }

  /** The PC's state; wakes the phones that wait. Null when the server is full. */
  setState(account: string, state: unknown) {
    const slot = this.slot(account, true)
    if (!slot) return null
    slot.state = state
    slot.stateAt = this.now()
    slot.version += 1
    for (const waiter of slot.phone) this.answerPhone(slot, waiter)
    slot.phone.clear()
    return slot.version
  }

  /** A phone's command; wakes the PC that waits. Null when the server is full. */
  addCommand(account: string, command: ScreenCommand) {
    const slot = this.slot(account, true)
    if (!slot) return null
    slot.lastId += 1
    slot.commands.push({ id: slot.lastId, at: this.now(), command })
    if (slot.commands.length > COMMANDS_KEPT) slot.commands.splice(0, slot.commands.length - COMMANDS_KEPT)
    for (const [waiter, since] of slot.pc) this.answerPc(slot, waiter, since)
    slot.pc.clear()
    return slot.lastId
  }

  private answerPhone(slot: Slot, waiter: Waiter) {
    if (waiter.done) return
    waiter.done = true
    this.release(waiter)
    waiter.res.json({ version: slot.version, pc: this.freshState(slot) })
  }

  private answerPc(slot: Slot, waiter: Waiter, since: number) {
    if (waiter.done) return
    waiter.done = true
    this.release(waiter)
    waiter.res.json({ last: slot.lastId, commands: this.pending(slot, since) })
  }

  /** The phone: the PC's state at once when its version is not `since`, else when the PC publishes, or after the wait. */
  waitState(res: Response, account: string, since?: number) {
    const slot = this.slot(account, true)
    if (!slot) { res.status(503).json({ error: 'Сервер занят. Попробуйте позже.' }); return }
    if (since === undefined || since !== slot.version || slot.phone.size >= WAITERS_PER_SLOT || this.waiters >= MAX_WAITERS) {
      res.json({ version: slot.version, pc: this.freshState(slot) })
      return
    }
    const waiter = this.hold(res, () => res.json({ version: slot.version, pc: this.freshState(slot) }), (entry) => slot.phone.delete(entry))
    slot.phone.add(waiter)
  }

  /**
   * The PC: the commands after `since` at once, else when the phone sends one, or none after the wait. Without `since`
   * (the PC app just started) only the number to wait from: taps made before it started are not replayed.
   */
  waitCommands(res: Response, account: string, since?: number) {
    const slot = this.slot(account, true)
    if (!slot) { res.status(503).json({ error: 'Сервер занят. Попробуйте позже.' }); return }
    if (since === undefined) { res.json({ last: slot.lastId, commands: [] }); return }
    const ready = this.pending(slot, since)
    if (ready.length || slot.pc.size >= WAITERS_PER_SLOT || this.waiters >= MAX_WAITERS) {
      res.json({ last: slot.lastId, commands: ready })
      return
    }
    const waiter = this.hold(res, () => res.json({ last: slot.lastId, commands: [] }), (entry) => slot.pc.delete(entry))
    slot.pc.set(waiter, since)
  }
}
