import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.js'

/**
 * «Всё, что происходит в приложении на ПК, абсолютно всё должно синхронизироваться с телефоном… и абсолютно в обе стороны» (owner,
 * 07.11.2026): the player's own lists and marks that have no route of their own (the promo codes used, «Избранное», the checks of a
 * raid, the map's drawings, «Купил», the hideout's levels…), one row per item of a list, per account (src/sync/playerState.ts).
 *
 *  - The newest change of an item wins, so two devices changing different items both win. Taking a tick off is a change too: the
 *    row stays with no value (a tombstone), or a device that still holds the item would bring it back.
 *  - `rev` counts the account's writes: a device asks for what came after the last one it saw, so it gets only what changed.
 *  - PvP, PvE and Season are `mode`; '' is what the whole account shares.
 *
 * Older apps know nothing of it and cannot erase it. The server does not read the values: it only keeps their size in check.
 */
export type StateMode = '' | 'pvp' | 'pve' | 'seasonal'

export interface StateRow {
  kind: string
  mode: StateMode
  item: string
  /** When the change was made, ms, by the server's clock as the device knows it. */
  at: number
  /** null: taken off. */
  value: unknown
}

export interface StateAnswer {
  /** What the device has seen after this answer; ask with it next time. */
  rev: number
  items: StateRow[]
  /** There is more after `rev`: ask again at once. */
  more: boolean
}

export const STATE_LIMITS = {
  /** One value: a drawn stroke is the largest there is. */
  valueBytes: 64 * 1024,
  /** Rows of an account, tombstones included. */
  rows: 20_000,
  /** Bytes of the values of an account. */
  bytes: 8 * 1024 * 1024,
  /** Rows a device sends at once, and those an answer carries. The body limit of the API is 1 MB (app.ts). */
  itemsPerSync: 500,
  pageRows: 500,
  pageBytes: 700 * 1024,
} as const

/** The time of an item a device found on itself the first time (src/sync/playerState.ts FIRST_AT): nobody knows when it was changed. */
const FIRST_AT = 1
/** A clock this far ahead is taken as a wrong clock: its change counts as made now, or it would beat every other for good. */
const AHEAD_MS = 60_000

interface Row { kind: unknown; mode: unknown; item: unknown; value: unknown; at: unknown; rev: unknown }

const rowKey = (row: Pick<StateRow, 'kind' | 'mode' | 'item'>) => `${row.kind}\n${row.mode}\n${row.item}`

function parsed(text: unknown): unknown {
  if (typeof text !== 'string') return null
  try { return JSON.parse(text) as unknown } catch { return null }
}

const toRow = (row: Row): StateRow => ({ kind: String(row.kind), mode: String(row.mode) as StateMode, item: String(row.item), at: Number(row.at), value: parsed(row.value) })

export class PlayerStateStore {
  constructor(private readonly db: DatabaseSync, private readonly limits: Partial<Record<keyof typeof STATE_LIMITS, number>> = {}) {
    db.exec(`CREATE TABLE IF NOT EXISTS user_state_items (
        account_id TEXT NOT NULL, kind TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('','pvp','pve','seasonal')), item TEXT NOT NULL,
        value TEXT, at INTEGER NOT NULL, rev INTEGER NOT NULL, PRIMARY KEY(account_id, kind, mode, item));
      CREATE INDEX IF NOT EXISTS user_state_items_rev ON user_state_items (account_id, rev);
      CREATE TABLE IF NOT EXISTS user_state_revs (account_id TEXT PRIMARY KEY, rev INTEGER NOT NULL);`)
  }

  private limit<K extends keyof typeof STATE_LIMITS>(name: K): number { return this.limits[name] ?? STATE_LIMITS[name] }

  /** The account's counter: it moves with every change kept. */
  rev(accountId: string) {
    const row = this.db.prepare('SELECT rev FROM user_state_revs WHERE account_id=?').get(accountId) as { rev?: unknown } | undefined
    return row ? Number(row.rev) : 0
  }

  private setRev(accountId: string, rev: number) {
    this.db.prepare(`INSERT INTO user_state_revs (account_id, rev) VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET rev=excluded.rev`).run(accountId, rev)
  }

  /** What changed after `since`, oldest first; `skip`: what the device has just sent itself. */
  changesSince(accountId: string, since: number, skip?: ReadonlySet<string>): StateAnswer {
    const pageRows = this.limit('pageRows')
    const rows = this.db.prepare('SELECT kind, mode, item, value, at, rev FROM user_state_items WHERE account_id=? AND rev>? ORDER BY rev LIMIT ?').all(accountId, since, pageRows + 1) as unknown as Row[]
    const items: StateRow[] = []
    let bytes = 0
    let rev = since
    let more = false
    for (const [index, row] of rows.entries()) {
      bytes += typeof row.value === 'string' ? row.value.length : 0
      if (index >= pageRows || (bytes > this.limit('pageBytes') && index > 0)) { more = true; break }
      rev = Number(row.rev)
      const answer = toRow(row)
      if (!skip?.has(rowKey(answer))) items.push(answer)
    }
    return { rev: more ? rev : this.rev(accountId), items, more }
  }

  /**
   * Keeps what is newer than the account's copy, per item, and answers with what the device does not know: what changed after
   * `since`, and each row of its that lost (it is told the one that stands). `kept`: rows really written; only those tell the
   * other devices (05.11.2026: a signal on every sync sent the apps round in a circle). `refused`: over the limits, stays on the device.
   */
  sync(accountId: string, since: number, rows: readonly StateRow[], now = Date.now()): StateAnswer & { now: number; kept: number; refused: number } {
    let kept = 0
    let refused = 0
    const own = new Set<string>()
    const lost = new Map<string, StateRow>()
    transaction(this.db, () => {
      const select = this.db.prepare('SELECT kind, mode, item, value, at, rev FROM user_state_items WHERE account_id=? AND kind=? AND mode=? AND item=?')
      const upsert = this.db.prepare(`INSERT INTO user_state_items (account_id, kind, mode, item, value, at, rev) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(account_id, kind, mode, item) DO UPDATE SET value=excluded.value, at=excluded.at, rev=excluded.rev`)
      let rev = this.rev(accountId)
      let totals: { rows: number; bytes: number } | null = null
      const room = () => totals ??= this.totals(accountId)
      for (const row of rows) {
        const at = row.at > now + AHEAD_MS ? now : row.at
        const text = row.value === null ? null : JSON.stringify(row.value)
        const size = text ? Buffer.byteLength(text) : 0
        if (size > this.limit('valueBytes')) { refused += 1; continue }
        const stored = select.get(accountId, row.kind, row.mode, row.item) as Row | undefined
        // Two devices' first looks at a number (a hideout level, a trader's, a count): the higher one is the further along, in whichever order they come.
        const furtherAlong = stored !== undefined && at === FIRST_AT && Number(stored.at) === FIRST_AT && typeof row.value === 'number' && typeof parsed(stored.value) === 'number' && row.value > (parsed(stored.value) as number)
        if (stored && Number(stored.at) >= at && !furtherAlong) {
          // The account's copy stands. Told back, unless the device holds the very same.
          if ((stored.value ?? null) !== text || Number(stored.at) !== row.at) lost.set(rowKey(row), toRow(stored))
          continue
        }
        const before = typeof stored?.value === 'string' ? Buffer.byteLength(stored.value) : 0
        if (!stored && room().rows >= this.limit('rows') && !this.trimTombstones(accountId, room())) { refused += 1; continue }
        if (size > before && room().bytes + size - before > this.limit('bytes')) { refused += 1; continue }
        rev += 1
        upsert.run(accountId, row.kind, row.mode, row.item, text, at, rev)
        const counts = room()
        if (!stored) counts.rows += 1
        counts.bytes += size - before
        kept += 1
        // A clock that was too far ahead: the device has to learn the time that counted.
        if (at === row.at) own.add(rowKey(row))
      }
      if (kept) this.setRev(accountId, rev)
    })
    const page = this.changesSince(accountId, since, own)
    const told = new Set(page.items.map(rowKey))
    return { ...page, items: [...page.items, ...[...lost.values()].filter((row) => !told.has(rowKey(row)))], now, kept, refused }
  }

  private totals(accountId: string) {
    const row = this.db.prepare('SELECT COUNT(*) AS rows, COALESCE(SUM(LENGTH(CAST(value AS BLOB))), 0) AS bytes FROM user_state_items WHERE account_id=?').get(accountId) as { rows: unknown; bytes: unknown }
    return { rows: Number(row.rows), bytes: Number(row.bytes) }
  }

  /** Full: the oldest tombstones go first (a device that long away keeps its item, nothing else is lost). True when there is room. */
  private trimTombstones(accountId: string, totals: { rows: number; bytes: number }) {
    const count = Math.max(1, Math.floor(this.limit('rows') / 10))
    const { changes } = this.db.prepare(`DELETE FROM user_state_items WHERE account_id=? AND rowid IN (
      SELECT rowid FROM user_state_items WHERE account_id=? AND value IS NULL ORDER BY at LIMIT ?)`).run(accountId, accountId, count)
    totals.rows -= Number(changes)
    return Number(changes) > 0
  }

  /**
   * A reset of the mode, from any app (POST /v1/me/progress/:mode/reset): what it wipes on a device goes from the account's copy
   * too, as tombstones the other devices will hear of. Only rows that exist: a device that first syncs after it never loses what
   * it holds. How many changed.
   */
  clearModeBefore(accountId: string, mode: Exclude<StateMode, ''>, kinds: readonly string[], at: number) {
    let changed = 0
    transaction(this.db, () => {
      let rev = this.rev(accountId)
      const rows = this.db.prepare(`SELECT kind, item FROM user_state_items WHERE account_id=? AND mode=? AND at<? AND value IS NOT NULL AND kind IN (${kinds.map(() => '?').join(',')})`).all(accountId, mode, at, ...kinds) as unknown as Array<{ kind: string; item: string }>
      const clear = this.db.prepare('UPDATE user_state_items SET value=NULL, at=?, rev=? WHERE account_id=? AND kind=? AND mode=? AND item=?')
      for (const row of rows) {
        rev += 1
        clear.run(at, rev, accountId, row.kind, mode, row.item)
        changed += 1
      }
      if (changed) this.setRev(accountId, rev)
    })
    return changed
  }
}
