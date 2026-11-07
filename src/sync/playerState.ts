/**
 * «Всё, что я делаю на телефоне, должно сразу передаваться на версию на ПК… И абсолютно в обе стороны» (owner, 07.11.2026): the player's
 * own lists and marks that have no route of their own go to the account as one row per item (POST /v1/me/state,
 * server/src/services/playerStateStore.ts), and the account's other devices hear of it at once on the wait they already keep
 * (GET /v1/me/social-events, `state`) and fetch only what changed.
 *
 * The stores keep their own format and know nothing of this. This engine keeps a shadow: per item, the time of its last change and a
 * hash of the value the account knows. A look at the stores (`scan`) compares them with it, so whatever changed a store — a click, a
 * reset, the end of a raid — is found the same way:
 *  - a new or different value is a change made now; an item gone is a change too (a tombstone), so taking a tick off travels;
 *  - what comes from the server is written to the store and to the shadow in one step, so it is never sent back (no echo);
 *  - the first look at a list on this account takes nothing away and its items count as old (FIRST_AT): whatever a device holds
 *    from before this update joins the account, and loses to anything really changed. An empty account never wipes a device;
 *  - the server decides which change of an item stands, the newest (no lost changes across devices, in any order).
 *
 * Nothing here throws into the UI. Without the server the changes wait in the shadow, with the time they were made.
 */
import type { RaidMode } from '../domain/types'

export type StateMode = '' | RaidMode
export const STATE_PATH = '/v1/me/state'
/** A click goes out this soon; several clicks in a row go in one write. */
export const STATE_SEND_DEBOUNCE_MS = 150
/** The time of an item found on a device the first time: older than any real change of it. */
export const FIRST_AT = 1
/** The server's limits (server/src/services/playerStateStore.ts): what is over them stays on this device. */
export const STATE_VALUE_BYTES = 64 * 1024
const ITEM_PATTERN = /^[\s\S]{1,300}$/
const ROWS_PER_SEND = 400
const BYTES_PER_SEND = 400 * 1024
const STORAGE_KEY = 'raidos-player-state-v1'

export interface StateAdapter {
  /** The name on the account; never changed once released. */
  kind: string
  /** `''`: one list for the whole account. Otherwise PvP, PvE and Season, each apart. */
  modes: readonly StateMode[]
  /** Item → a value JSON can carry (never null). null: cannot tell now (nothing bound yet, damaged storage): the list is left alone. */
  read: (mode: StateMode) => ReadonlyMap<string, unknown> | null
  /** The whole list after a change from the server, in the store's own format; tells the store's listeners. */
  write: (mode: StateMode, next: ReadonlyMap<string, unknown>) => void
  /** Only ever grows («Прочитано»): an item missing here is no news. */
  addOnly?: boolean
  /** A value the store can take; anything else from the network is dropped. */
  accepts?: (value: unknown, item: string, mode: StateMode) => boolean
}

export interface StateRow { kind: string; mode: StateMode; item: string; at: number; value: unknown }
type Transport = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown>

/** `a`: when it last changed; `h`: the hash of its value; `d`: taken off; `u`: the account has not heard of it yet. */
interface Entry { a: number; h: string; d?: 1; u?: 1 }
interface Shadow { account: string; rev: number; skew: number; lists: Record<string, Record<string, Entry>> }

/** The same text whatever the order of an object's keys. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** cyrb53: a short name for a value, kept instead of the value itself. */
export function hashOf(text: string): string {
  let a = 0xdeadbeef
  let b = 0x41c6ce57
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 2654435761)
    b = Math.imul(b ^ code, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36)
}

const valueHash = (value: unknown) => hashOf(canonicalJson(value))
const listKey = (kind: string, mode: StateMode) => `${kind}/${mode}`
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

let adapters: readonly StateAdapter[] = []
let transport: Transport | null = null
let shadow: Shadow | null = null
/** The account and profile signed in now. */
let accountKey: string | null = null
let online = false
let busy = false
let again = false
let timer: ReturnType<typeof setTimeout> | null = null
/** The newest counter the live channel told. */
let heardRev: number | undefined
let heardAt = 0
/** Asked for what the others changed. */
let pullWanted = false

function loadShadow(account: string): Shadow {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Shadow> | null
    if (stored && stored.account === account && number(stored.rev) && stored.lists && typeof stored.lists === 'object') {
      return { account, rev: stored.rev, skew: number(stored.skew) ? stored.skew : 0, lists: stored.lists }
    }
  } catch { /* a damaged value starts over: the first look at every list takes nothing away */ }
  return { account, rev: 0, skew: 0, lists: {} }
}

function saveShadow() {
  if (!shadow) return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(shadow)) } catch { /* storage full: kept for this run; a new start looks at the lists as for the first time */ }
}

/**
 * Who this device syncs as: the account and the local profile whose lists it shows; null while nobody is signed in. Another one
 * starts over, without taking anything away from either side.
 */
export function setPlayerStateAccount(account: string | null, isOnline = true) {
  accountKey = account
  online = Boolean(account) && isOnline
  if (account && shadow?.account !== account) {
    shadow = loadShadow(account)
    heardRev = undefined
    pullWanted = true
  }
}

/**
 * Signed out, or «Удалить все данные»: what the lists looked like then says nothing about what they look like next, so nothing goes
 * out for it. The next look is a first one: it takes nothing away from the account, and the account's lists come back here.
 */
export function forgetPlayerStateSync() {
  shadow = null
  pullWanted = accountKey !== null
  if (timer) { clearTimeout(timer); timer = null }
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* storage unavailable */ }
}

export function configurePlayerState(options: { adapters: readonly StateAdapter[]; transport: Transport }) {
  adapters = options.adapters
  transport = options.transport
}

/** Tests: everything the module remembers. */
export function resetPlayerStateForTests() {
  accountKey = null
  forgetPlayerStateSync()
  adapters = []
  transport = null
  online = false
  busy = false
  again = false
  heardRev = undefined
  heardAt = 0
}

const now = () => Date.now() + (shadow?.skew ?? 0)
/** A change here is always newer than what this device has seen of the item, whatever the clocks say. */
const stamp = (entry: Entry | undefined) => Math.max(Math.round(now()), (entry?.a ?? 0) + 1)

function readList(adapter: StateAdapter, mode: StateMode) {
  try { return adapter.read(mode) } catch { return null }
}

/** Compares every list with the shadow: what differs is a change made now. */
export function scanPlayerState() {
  if (!shadow) return false
  let changed = false
  for (const adapter of adapters) {
    for (const mode of adapter.modes) {
      const current = readList(adapter, mode)
      if (!current) continue
      const key = listKey(adapter.kind, mode)
      const known = shadow.lists[key]
      const first = !known
      const entries = known ?? (shadow.lists[key] = {})
      if (first) {
        changed = true
        // A list this device never looked at: what the account already holds of it (another device's) is asked for again.
        shadow.rev = 0
        pullWanted = true
      }
      for (const [item, value] of current) {
        if (!ITEM_PATTERN.test(item)) continue
        const hash = valueHash(value)
        const entry = entries[item]
        if (entry && !entry.d && entry.h === hash) continue
        entries[item] = { a: first ? FIRST_AT : stamp(entry), h: hash, u: 1 }
        changed = true
      }
      if (first || adapter.addOnly) continue
      for (const [item, entry] of Object.entries(entries)) {
        if (entry.d || current.has(item)) continue
        entries[item] = { a: stamp(entry), h: '', d: 1, u: 1 }
        changed = true
      }
    }
  }
  if (changed) saveShadow()
  return changed
}

/** What the account has not heard of yet, within what one write takes. A value over the limit stays on this device. */
function outgoing(): StateRow[] {
  const rows: StateRow[] = []
  if (!shadow) return rows
  let bytes = 0
  for (const adapter of adapters) {
    for (const mode of adapter.modes) {
      const entries = shadow.lists[listKey(adapter.kind, mode)]
      if (!entries) continue
      const current = readList(adapter, mode)
      if (!current) continue
      for (const [item, entry] of Object.entries(entries)) {
        if (!entry.u) continue
        if (rows.length >= ROWS_PER_SEND || bytes >= BYTES_PER_SEND) return rows
        const value = entry.d ? null : current.get(item)
        if (value === undefined) continue
        const size = value === null ? 0 : canonicalJson(value).length
        if (size > STATE_VALUE_BYTES) { delete entry.u; continue }
        bytes += size + item.length
        rows.push({ kind: adapter.kind, mode, item, at: entry.a, value })
      }
    }
  }
  return rows
}

/** The answer's rows into the stores and the shadow together. */
function applyRows(rows: readonly StateRow[]) {
  if (!shadow) return
  const lists = new Map<string, { adapter: StateAdapter; mode: StateMode; rows: StateRow[] }>()
  for (const row of rows) {
    const adapter = adapters.find((entry) => entry.kind === row.kind && entry.modes.includes(row.mode))
    if (!adapter) continue // a newer app's list: read again once this app knows it (scanPlayerState, the first look)
    const key = listKey(row.kind, row.mode)
    const list = lists.get(key) ?? { adapter, mode: row.mode, rows: [] }
    list.rows.push(row)
    lists.set(key, list)
  }
  for (const [key, list] of lists) {
    const before = readList(list.adapter, list.mode)
    if (!before) { shadow.rev = 0; continue } // the store cannot be read now: asked for again later
    const entries = shadow.lists[key] ?? (shadow.lists[key] = {})
    const next = new Map(before)
    const applied: StateRow[] = []
    let changed = false
    for (const row of list.rows) {
      const entry = entries[row.item]
      // This device's own change, not heard of yet and as new: it goes out, and the server decides.
      if (entry?.u && entry.a >= row.at) continue
      if (row.value !== null && list.adapter.accepts && !list.adapter.accepts(row.value, row.item, row.mode)) continue
      if (row.value === null) {
        if (next.delete(row.item)) changed = true
      } else if (!next.has(row.item) || valueHash(next.get(row.item)) !== valueHash(row.value)) {
        next.set(row.item, row.value)
        changed = true
      }
      applied.push(row)
    }
    if (changed) {
      try { list.adapter.write(list.mode, next) } catch { shadow.rev = 0; continue }
    }
    // What the store holds now is what this device agrees with, in the store's own shape: nothing goes back.
    const after = changed ? readList(list.adapter, list.mode) ?? next : next
    for (const row of applied) {
      const held = after.get(row.item)
      entries[row.item] = held === undefined ? { a: row.at, h: '', d: 1 } : { a: row.at, h: valueHash(held) }
    }
  }
}

function parseRows(value: unknown): StateRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): StateRow[] => {
    const row = entry as Partial<StateRow> | null
    if (!row || typeof row.kind !== 'string' || typeof row.item !== 'string' || !number(row.at)) return []
    if (row.mode !== '' && row.mode !== 'pvp' && row.mode !== 'pve' && row.mode !== 'seasonal') return []
    return [{ kind: row.kind, mode: row.mode, item: row.item, at: row.at, value: row.value ?? null }]
  })
}

/** An answer: what was sent is settled, what came in is applied. Returns whether there is more to ask for. */
function settle(sent: readonly StateRow[], answer: { rev?: unknown; items?: unknown; more?: unknown; now?: unknown }, asked: number, since: number) {
  if (!shadow) return false
  if (number(answer.now)) shadow.skew = Math.round(answer.now - (asked + Date.now()) / 2)
  for (const row of sent) {
    const entry = shadow.lists[listKey(row.kind, row.mode)]?.[row.item]
    if (entry && entry.a === row.at) delete entry.u
  }
  applyRows(parseRows(answer.items))
  if (!number(answer.rev)) return false
  if (answer.rev < since) {
    // The account's copy went back (a restored database): it takes everything again, each item with its time; the server decides.
    for (const entries of Object.values(shadow.lists)) for (const entry of Object.values(entries)) entry.u = 1
    shadow.rev = 0
    return true
  }
  // The store could not take a list: `rev` stays 0 and it is asked for again at the next round, not now.
  if (shadow.rev === since) shadow.rev = answer.rev
  return answer.more === true
}

/** The live channel told of a change this device has not seen. */
const revBehind = () => heardRev !== undefined && shadow !== null && heardRev > shadow.rev

/** Looks at the lists, sends what changed, fetches what the others changed. Only one at a time; a later call runs right after it. */
export async function syncPlayerState(options: { pull?: boolean } = {}): Promise<void> {
  if (options.pull) pullWanted = true
  if (!shadow && accountKey) shadow = loadShadow(accountKey)
  if (!shadow || !transport) return
  scanPlayerState()
  if (!online) return
  if (busy) { again = true; return }
  busy = true
  try {
    for (let round = 0; round < 50; round += 1) {
      const account: string | undefined = shadow?.account
      const rows = outgoing()
      if (!account || (!rows.length && !pullWanted && !revBehind())) break
      const since = shadow!.rev
      const asked = Date.now()
      pullWanted = false
      const answer = await transport(rows.length ? 'POST' : 'GET', rows.length ? STATE_PATH : `${STATE_PATH}?since=${since}`, rows.length ? { since, items: rows } : undefined).catch(() => null)
      // No server, an older server without the route, or the limit: it all waits for the next round (useServerSync's pace).
      if (!answer || typeof answer !== 'object') { pullWanted = pullWanted || !rows.length; break }
      // Another account signed in meanwhile: this answer is not its.
      if (shadow?.account !== account) break
      if (settle(rows, answer as Record<string, unknown>, asked, since)) pullWanted = true
      // The server's own answer outranks what the channel told earlier: nothing to fetch until it tells something new.
      if (!rows.length && !pullWanted && heardRev !== undefined && heardRev > shadow.rev) heardRev = shadow.rev
      saveShadow()
      scanPlayerState()
    }
  } finally {
    busy = false
    if (again) { again = false; schedulePlayerStateSync() }
  }
}

/** A store changed: it goes out in a moment. */
export function schedulePlayerStateSync(delayMs = STATE_SEND_DEBOUNCE_MS) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void syncPlayerState() }, delayMs)
}

/** Going to the background (a phone is locked next): what waits goes now. */
export function flushPlayerState() {
  if (timer) { clearTimeout(timer); timer = null }
  void syncPlayerState()
}

/**
 * The account's counter as the live channel tells it (the GET /v1/me/social-events answer). Moved past what this device has seen:
 * another device changed something. This device's own write moves it too, and that fetches nothing.
 */
export function notePlayerStateRev(rev: number) {
  heardRev = rev
  heardAt = Date.now()
  if (!shadow) return
  // Lower than what this device saw: an old answer on its way, or the account's copy went back (settle finds out which).
  if (rev < shadow.rev) pullWanted = true
  if (rev !== shadow.rev) schedulePlayerStateSync(0)
}

/** How long a silent channel is believed: the periodic sync asks by itself after this. */
const CHANNEL_TRUSTED_MS = 60_000

/** The periodic round (every ~30 s): sends what still waits; asks the server itself only when the live channel has gone silent. */
export function playerStateTick() {
  return syncPlayerState({ pull: heardRev === undefined || Date.now() - heardAt > CHANNEL_TRUSTED_MS })
}

/**
 * What the wait on GET /v1/me/social-events adds for this module (data/mapUpdates.ts watchVersion): it asks to be woken when the
 * counter moves past the one last told. An older server answers without it; the periodic round still gets there.
 */
export const playerStateChannel = {
  query: () => (heardRev === undefined ? '' : `&state=${heardRev}`),
  heard: (answer: unknown) => {
    const rev = (answer as { state?: unknown } | null)?.state
    if (!number(rev)) return false
    const moved = rev !== heardRev
    notePlayerStateRev(rev)
    return moved
  },
}
