import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StateAdapter, StateMode, StateRow } from './playerState'

type Engine = typeof import('./playerState')

/**
 * The account on the server, with its rules (server/src/services/playerStateStore.ts: the newest change of an item stands, the same
 * time keeps what is there, a row that lost is told back). The real one is tested in server/src/routes/playerState.test.ts and with
 * two of these engines over HTTP in playerState.server.test.ts.
 */
class Account {
  rows = new Map<string, StateRow & { rev: number }>()
  rev = 0
  writes: StateRow[][] = []
  reads = 0
  now = 1_000_000
  private key = (row: StateRow) => `${row.kind}\n${row.mode}\n${row.item}`
  page(since: number, skip = new Set<string>()) {
    return [...this.rows.values()].filter((row) => row.rev > since && !skip.has(this.key(row))).sort((a, b) => a.rev - b.rev).map(({ rev: _rev, ...row }) => row)
  }
  request = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    if (method === 'GET') {
      this.reads += 1
      return { rev: this.rev, items: this.page(Number(/since=(\d+)/.exec(path)?.[1] ?? 0)), more: false, now: this.now }
    }
    const { since, items } = body as { since: number; items: StateRow[] }
    this.writes.push(items)
    const own = new Set<string>()
    const lost: StateRow[] = []
    let kept = 0
    for (const row of items) {
      const stored = this.rows.get(this.key(row))
      if (stored && stored.at >= row.at) {
        if (JSON.stringify(stored.value) !== JSON.stringify(row.value) || stored.at !== row.at) { const { rev: _rev, ...told } = stored; lost.push(told) }
        continue
      }
      this.rows.set(this.key(row), { ...row, rev: ++this.rev })
      own.add(this.key(row))
      kept += 1
    }
    const page = this.page(since, own)
    return { rev: this.rev, items: [...page, ...lost.filter((row) => !page.some((entry) => this.key(entry) === this.key(row)))], more: false, now: this.now, kept, refused: 0 }
  }
}

/** A device: its own engine and lists held in memory, like a store with a format of its own. */
interface Device {
  engine: Engine
  sets: Map<string, Map<string, unknown>>
  writes: string[]
  list: (kind: string, mode?: StateMode) => Map<string, unknown>
  sync: (options?: { pull?: boolean }) => Promise<void>
}

async function device(account: Account, name: string, lists: Array<{ kind: string; modes?: StateMode[]; addOnly?: boolean; shape?: (value: unknown) => unknown }> = [{ kind: 'promo-used' }]): Promise<Device> {
  vi.resetModules()
  const engine = await import('./playerState')
  const sets = new Map<string, Map<string, unknown>>()
  const writes: string[] = []
  const list = (kind: string, mode: StateMode = '') => {
    const key = `${kind}/${mode}`
    if (!sets.has(key)) sets.set(key, new Map())
    return sets.get(key)!
  }
  const adapters: StateAdapter[] = lists.map(({ kind, modes = [''], addOnly, shape }) => ({
    kind, modes, ...(addOnly ? { addOnly } : {}),
    read: (mode) => list(kind, mode),
    write: (mode, next) => {
      writes.push(`${kind}/${mode}`)
      sets.set(`${kind}/${mode}`, new Map([...next].map(([item, value]) => [item, shape ? shape(value) : value])))
    },
  }))
  engine.configurePlayerState({ adapters, transport: (method, path, body) => account.request(method, path, body) })
  // A name of this device alone: the two engines in one test share the test's storage, not their shadows.
  engine.setPlayerStateAccount(`account-of-${name}`)
  return { engine, sets, writes, list, sync: (options) => engine.syncPlayerState(options) }
}

const tickBoth = async (...devices: Device[]) => { for (const entry of devices) await entry.sync({ pull: true }); for (const entry of devices) await entry.sync({ pull: true }) }
const values = (list: Map<string, unknown>) => [...list.keys()].sort()

describe('the player\'s own lists between devices', () => {
  beforeEach(() => { localStorage.clear() })

  it('a code used on the PC is ticked on the phone, and taking it off travels back', async () => {
    const account = new Account()
    const pc = await device(account, 'pc')
    const phone = await device(account, 'phone')
    await tickBoth(pc, phone)

    pc.list('promo-used').set('CODE', true)
    await pc.sync()
    await phone.sync({ pull: true })
    expect(values(phone.list('promo-used'))).toEqual(['CODE'])

    phone.list('promo-used').delete('CODE')
    await phone.sync()
    expect(account.writes.at(-1)).toEqual([expect.objectContaining({ item: 'CODE', value: null })])
    await pc.sync({ pull: true })
    expect(values(pc.list('promo-used'))).toEqual([])
  })

  it('applying a change from the server sends nothing back', async () => {
    const account = new Account()
    const pc = await device(account, 'pc')
    const phone = await device(account, 'phone')
    await tickBoth(pc, phone)
    pc.list('promo-used').set('CODE', true)
    await pc.sync()
    const before = account.writes.length

    await phone.sync({ pull: true })
    await phone.sync({ pull: true })
    await pc.sync({ pull: true })
    expect(values(phone.list('promo-used'))).toEqual(['CODE'])
    expect(account.writes.length).toBe(before)
    expect(account.rev).toBe(1)
  })

  it('a store that shapes a value its own way still sends nothing back', async () => {
    const account = new Account()
    const lists = [{ kind: 'trading', shape: (value: unknown) => ({ ...(value as object), notify: true }) }]
    const pc = await device(account, 'pc', [{ kind: 'trading' }])
    const phone = await device(account, 'phone', lists)
    await tickBoth(pc, phone)
    pc.list('trading').set('item', { paid: 5 })
    await pc.sync()
    const before = account.writes.length
    await phone.sync({ pull: true })
    expect(phone.list('trading').get('item')).toEqual({ paid: 5, notify: true })
    await phone.sync({ pull: true })
    expect(account.writes.length).toBe(before)
  })

  it('the first sync joins what each device has: an empty account wipes nothing, nothing is lost', async () => {
    const account = new Account()
    const pc = await device(account, 'pc')
    const phone = await device(account, 'phone')
    pc.list('promo-used').set('A', true).set('B', true)
    phone.list('promo-used').set('B', true).set('C', true)
    await tickBoth(pc, phone)
    expect(values(pc.list('promo-used'))).toEqual(['A', 'B', 'C'])
    expect(values(phone.list('promo-used'))).toEqual(['A', 'B', 'C'])
    // Nothing was taken off on the way.
    expect([...account.rows.values()].every((row) => row.value !== null)).toBe(true)
  })

  it('two devices changing different items offline both win', async () => {
    const account = new Account()
    const pc = await device(account, 'pc')
    const phone = await device(account, 'phone')
    pc.list('promo-used').set('OLD', true)
    await tickBoth(pc, phone)

    pc.list('promo-used').set('FROM-PC', true)
    phone.list('promo-used').set('FROM-PHONE', true)
    phone.list('promo-used').delete('OLD')
    await tickBoth(pc, phone)
    expect(values(pc.list('promo-used'))).toEqual(['FROM-PC', 'FROM-PHONE'])
    expect(values(phone.list('promo-used'))).toEqual(['FROM-PC', 'FROM-PHONE'])
  })

  it('a device that comes later with an old copy does not bring back what was taken off', async () => {
    const account = new Account()
    const phone = await device(account, 'phone')
    phone.list('promo-used').set('CODE', true)
    await phone.sync()
    phone.list('promo-used').delete('CODE')
    await phone.sync()

    const pc = await device(account, 'pc')
    pc.list('promo-used').set('CODE', true)
    await pc.sync({ pull: true })
    expect(values(pc.list('promo-used'))).toEqual([])
    await phone.sync({ pull: true })
    expect(values(phone.list('promo-used'))).toEqual([])
  })

  it('PvP, PvE and Season stay apart', async () => {
    const account = new Account()
    const lists = [{ kind: 'quest-checks', modes: ['pvp', 'pve', 'seasonal'] as StateMode[] }]
    const pc = await device(account, 'pc', lists)
    const phone = await device(account, 'phone', lists)
    await tickBoth(pc, phone)
    pc.list('quest-checks', 'pve').set('quest', 5)
    await tickBoth(pc, phone)
    expect(phone.list('quest-checks', 'pve').get('quest')).toBe(5)
    expect(values(phone.list('quest-checks', 'pvp'))).toEqual([])
    expect(values(phone.list('quest-checks', 'seasonal'))).toEqual([])
    expect(phone.writes).toEqual(['quest-checks/pve'])
  })

  it('this device\'s change stands against an older one from the server, and goes out', async () => {
    const account = new Account()
    const pc = await device(account, 'pc', [{ kind: 'levels' }])
    pc.list('levels').set('station', 1)
    await pc.sync()
    account.now = 2_000_000
    await pc.sync({ pull: true })

    pc.list('levels').set('station', 3)
    // Older than what is about to go: comes in while this device's change has not been heard yet.
    account.rows.set('levels\n\nstation', { kind: 'levels', mode: '', item: 'station', at: 5, value: 2, rev: ++account.rev })
    await pc.sync({ pull: true })
    expect(pc.list('levels').get('station')).toBe(3)
    expect(account.rows.get('levels\n\nstation')?.value).toBe(3)
  })

  it('a click always beats what this device has seen, even on a clock running behind', async () => {
    const account = new Account()
    const pc = await device(account, 'pc')
    const phone = await device(account, 'phone')
    await tickBoth(pc, phone)
    account.rows.set('promo-used\n\nCODE', { kind: 'promo-used', mode: '', item: 'CODE', at: Date.now() + 86_400_000, value: true, rev: ++account.rev })
    await phone.sync({ pull: true })
    expect(values(phone.list('promo-used'))).toEqual(['CODE'])
    phone.list('promo-used').delete('CODE')
    await phone.sync()
    expect(account.rows.get('promo-used\n\nCODE')?.value).toBeNull()
  })

  it('a list that cannot be read now takes nothing off', async () => {
    const account = new Account()
    vi.resetModules()
    const engine = await import('./playerState')
    let broken = false
    const held = new Map<string, unknown>([['CODE', true]])
    engine.configurePlayerState({ adapters: [{ kind: 'promo-used', modes: [''], read: () => (broken ? null : held), write: () => {} }], transport: account.request })
    engine.setPlayerStateAccount('a')
    await engine.syncPlayerState()
    expect(account.rows.get('promo-used\n\nCODE')?.value).toBe(true)
    broken = true
    await engine.syncPlayerState({ pull: true })
    expect(account.rows.get('promo-used\n\nCODE')?.value).toBe(true)
    expect(account.writes.length).toBe(1)
  })

  it('«Удалить все данные» and a sign-out take nothing off the account; the lists come back', async () => {
    const account = new Account()
    const pc = await device(account, 'pc')
    const phone = await device(account, 'phone')
    pc.list('promo-used').set('CODE', true)
    await tickBoth(pc, phone)

    pc.engine.forgetPlayerStateSync()
    pc.list('promo-used').clear()
    await pc.sync({ pull: true })
    expect(account.rows.get('promo-used\n\nCODE')?.value).toBe(true)
    expect(values(pc.list('promo-used'))).toEqual(['CODE'])

    await phone.sync({ pull: true })
    expect(values(phone.list('promo-used'))).toEqual(['CODE'])
  })

  it('without a server the change waits, with the time it was made', async () => {
    const account = new Account()
    const pc = await device(account, 'pc')
    await pc.sync()
    pc.engine.setPlayerStateAccount('account-of-pc', false)
    pc.list('promo-used').set('OFFLINE', true)
    await pc.sync()
    expect(account.writes.length).toBe(0)
    const made = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 5))
    pc.engine.setPlayerStateAccount('account-of-pc', true)
    await pc.sync()
    const sent = account.rows.get('promo-used\n\nOFFLINE')!
    expect(sent.at).toBeLessThanOrEqual(made)
  })

  it('a server that fails, or does not know the route yet, loses nothing and is asked again', async () => {
    vi.resetModules()
    const engine = await import('./playerState')
    const account = new Account()
    let down = true
    const held = new Map<string, unknown>([['CODE', true]])
    engine.configurePlayerState({ adapters: [{ kind: 'promo-used', modes: [''], read: () => held, write: () => {} }], transport: (method, path, body) => (down ? Promise.resolve(null) : account.request(method, path, body)) })
    engine.setPlayerStateAccount('a')
    await engine.syncPlayerState()
    expect(account.writes.length).toBe(0)
    down = false
    await engine.syncPlayerState()
    expect(account.rows.get('promo-used\n\nCODE')?.value).toBe(true)
  })

  it('a list this app did not know yet is asked for from the start once it does', async () => {
    const account = new Account()
    const newer = await device(account, 'newer', [{ kind: 'promo-used' }, { kind: 'new-list' }])
    newer.list('new-list').set('X', 1)
    await newer.sync()
    // An older app sees a row of a list it does not know, and moves on.
    const older = await device(account, 'older')
    await older.sync({ pull: true })
    expect(older.writes).toEqual([])
    // Updated: its first look at the list asks for all of it.
    vi.resetModules()
    const engine = await import('./playerState')
    const held = new Map<string, unknown>()
    engine.configurePlayerState({ adapters: [{ kind: 'promo-used', modes: [''], read: () => new Map(), write: () => {} }, { kind: 'new-list', modes: [''], read: () => held, write: (_mode, next) => { for (const [key, value] of next) held.set(key, value) } }], transport: account.request })
    engine.setPlayerStateAccount('account-of-older-updated')
    await engine.syncPlayerState()
    expect(held.get('X')).toBe(1)
  })

  it('an account copy that went back (a restored database) takes everything again', async () => {
    const account = new Account()
    const pc = await device(account, 'pc')
    pc.list('promo-used').set('CODE', true)
    await pc.sync()
    account.rows.clear()
    account.rev = 0
    await pc.sync({ pull: true })
    expect(account.rows.get('promo-used\n\nCODE')?.value).toBe(true)
    expect(values(pc.list('promo-used'))).toEqual(['CODE'])
  })

  it('a value over the limit stays on this device and does not hold up the rest', async () => {
    const account = new Account()
    const pc = await device(account, 'pc', [{ kind: 'map-sketch' }])
    pc.list('map-sketch').set('big', 'x'.repeat(70_000)).set('small', 'y')
    await pc.sync()
    expect([...account.rows.values()].map((row) => row.item)).toEqual(['small'])
    await pc.sync()
    expect(account.writes.length).toBe(1)
  })

  it('a list that only grows sends no tombstones', async () => {
    const account = new Account()
    const pc = await device(account, 'pc', [{ kind: 'news-read', addOnly: true }])
    pc.list('news-read').set('0.6.0.270', true).set('0.6.0.271', true)
    await pc.sync()
    pc.list('news-read').delete('0.6.0.271')
    await pc.sync()
    expect(account.rows.get('news-read\n\n0.6.0.271')?.value).toBe(true)
  })

  it('the live channel: another device\'s change is fetched at once, this device\'s own write fetches nothing', async () => {
    vi.useFakeTimers()
    try {
      const account = new Account()
      const pc = await device(account, 'pc')
      await pc.sync()
      expect(pc.engine.playerStateChannel.query()).toBe('')

      pc.list('promo-used').set('MINE', true)
      await pc.sync()
      const reads = account.reads
      expect(pc.engine.playerStateChannel.heard({ version: 1, state: account.rev })).toBe(true)
      expect(pc.engine.playerStateChannel.query()).toBe(`&state=${account.rev}`)
      await vi.advanceTimersByTimeAsync(50)
      expect(account.reads).toBe(reads)

      account.rows.set('promo-used\n\nTHEIRS', { kind: 'promo-used', mode: '', item: 'THEIRS', at: Date.now(), value: true, rev: ++account.rev })
      expect(pc.engine.playerStateChannel.heard({ version: 1, state: account.rev })).toBe(true)
      await vi.advanceTimersByTimeAsync(50)
      expect(account.reads).toBe(reads + 1)
      expect(values(pc.list('promo-used'))).toEqual(['MINE', 'THEIRS'])

      // Nothing moved: no fetch; an older server says nothing of it: nothing happens.
      expect(pc.engine.playerStateChannel.heard({ version: 2, state: account.rev })).toBe(false)
      expect(pc.engine.playerStateChannel.heard({ version: 3 })).toBe(false)
      await vi.advanceTimersByTimeAsync(50)
      expect(account.reads).toBe(reads + 1)
    } finally { vi.useRealTimers() }
  })

  it('the periodic round asks by itself only when the live channel has gone silent', async () => {
    vi.useFakeTimers()
    try {
      const account = new Account()
      const pc = await device(account, 'pc')
      await pc.sync()
      pc.engine.playerStateChannel.heard({ version: 1, state: account.rev })
      const reads = account.reads
      await pc.engine.playerStateTick()
      expect(account.reads).toBe(reads)
      await vi.advanceTimersByTimeAsync(61_000)
      await pc.engine.playerStateTick()
      expect(account.reads).toBe(reads + 1)
    } finally { vi.useRealTimers() }
  })

  it('a change goes out within a moment of the click, and several clicks in one write', async () => {
    vi.useFakeTimers()
    try {
      const account = new Account()
      const pc = await device(account, 'pc')
      await pc.sync()
      pc.list('promo-used').set('A', true)
      pc.engine.schedulePlayerStateSync()
      await vi.advanceTimersByTimeAsync(50)
      pc.list('promo-used').set('B', true)
      pc.engine.schedulePlayerStateSync()
      expect(account.writes.length).toBe(0)
      await vi.advanceTimersByTimeAsync(pc.engine.STATE_SEND_DEBOUNCE_MS)
      expect(pc.engine.STATE_SEND_DEBOUNCE_MS).toBeLessThan(1000)
      expect(account.writes.length).toBe(1)
      expect(account.writes[0]!.map((row) => row.item).sort()).toEqual(['A', 'B'])
    } finally { vi.useRealTimers() }
  })
})
