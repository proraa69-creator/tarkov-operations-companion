/**
 * «Правки карты сразу у всех»: every app waits here for the owner's next map correction (long polling).
 *
 *   GET /v1/map-updates                -> { version } at once
 *   GET /v1/map-updates?since=<version> -> { version } as soon as the version differs from `since`, or after ~25 s with
 *                                         the same version (the app simply asks again)
 *
 * The version changes on every write of quest points (routes/questPoints.ts) and owner boss placements
 * (routes/mapBosses.ts); the app then re-reads /v1/quest-points and /v1/map-bosses. It starts from the server's start
 * time, so a restarted server also counts as «changed». Long polling, not SSE / WebSocket: it travels through the
 * desktop app's ordinary request gateway (electron/serviceGateway.ts) and every proxy in front of the server.
 * Waiting requests are capped per address and in total; over the cap the answer comes at once.
 */
import express from 'express'
import type { Response } from 'express'
import { z } from 'zod'

export const MAP_UPDATE_WAIT_MS = 25_000
const MAX_WAITING = 5_000
const MAX_WAITING_PER_ADDRESS = 8

const querySchema = z.object({ since: z.string().regex(/^\d{1,16}$/).optional() })

type Fields = () => Record<string, unknown>

interface Waiter { res: Response; address: string; timer: ReturnType<typeof setTimeout>; own?: Fields }

export class MapUpdates {
  private current: number
  private readonly waiters = new Set<Waiter>()
  private readonly perAddress = new Map<string, number>()

  /** `extra`: fields sent along with the version in every answer (the owner's «Заявки» count, routes/bugReports.ts). */
  constructor(start = Date.now(), private readonly waitMs = MAP_UPDATE_WAIT_MS, private readonly extra?: Fields) {
    this.current = start
  }

  private body(own?: Fields) {
    const fields: Record<string, unknown> = {}
    for (const source of [this.extra, own]) {
      try { Object.assign(fields, source?.()) } catch { /* the version alone still wakes the app */ }
    }
    return { ...fields, version: this.current }
  }

  get version() { return this.current }
  get waiting() { return this.waiters.size }

  /** A correction was saved: every waiting app gets the new version now. */
  changed() {
    this.current += 1
    for (const waiter of [...this.waiters]) this.answer(waiter)
  }

  /**
   * Answers now (version differs, or no room to wait) or when the version changes / the wait runs out. `own`: this
   * request's fields, read when it is answered (the notice in the reader's language, routes/announcement.ts).
   */
  wait(res: Response, address: string, since: number | undefined, own?: Fields) {
    const count = this.perAddress.get(address) ?? 0
    if (since === undefined || since !== this.current || this.waiters.size >= MAX_WAITING || count >= MAX_WAITING_PER_ADDRESS) {
      res.json(this.body(own))
      return
    }
    const waiter: Waiter = { res, address, own, timer: setTimeout(() => this.answer(waiter), this.waitMs) }
    this.waiters.add(waiter)
    this.perAddress.set(address, count + 1)
    // The app went away (closed, timed out): forget it without answering.
    res.on('close', () => this.forget(waiter))
  }

  private answer(waiter: Waiter) {
    if (!this.forget(waiter)) return
    if (!waiter.res.writableEnded && !waiter.res.destroyed) waiter.res.json(this.body(waiter.own))
  }

  private forget(waiter: Waiter) {
    if (!this.waiters.delete(waiter)) return false
    clearTimeout(waiter.timer)
    const left = (this.perAddress.get(waiter.address) ?? 1) - 1
    if (left > 0) this.perAddress.set(waiter.address, left)
    else this.perAddress.delete(waiter.address)
    return true
  }
}

export function createMapUpdatesRouter(updates: MapUpdates) {
  const router = express.Router()
  router.get('/v1/map-updates', (req, res) => {
    res.set('Cache-Control', 'no-store')
    const query = querySchema.safeParse(req.query)
    if (!query.success) { res.status(400).json({ error: 'Некорректный запрос' }); return }
    updates.wait(res, req.ip ?? req.socket.remoteAddress ?? 'unknown', query.data.since === undefined ? undefined : Number(query.data.since))
  })
  return router
}
