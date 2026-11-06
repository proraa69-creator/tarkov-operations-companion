import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { MirrorStorage } from './mirrorStorage.js'
import { applyPriceOverlay, normalizePrices, PriceMirror, type PriceSnapshot } from './priceMirror.js'
import { overlayKeyFrom, parseOverlay, PriceOverlay } from './priceOverlay.js'

const MINUTE = 60_000
const KEY = 'test-key-not-a-real-one-1234567890'
const NOW = Date.parse('2026-11-06T02:00:00.000Z')
const id = (n: number) => `${n}`.padStart(24, 'a')
const ago = (minutes: number, from = NOW) => new Date(from - minutes * MINUTE).toISOString()
/** A row as its API documents it. */
const row = (n: number, price: number, updated: string, patch: Record<string, unknown> = {}) => ({ uid: `uid-${n}`, bsgId: id(n), name: `Item ${n}`, price, avg24hPrice: price + 1, updated, haveMarketData: true, bannedOnFlea: false, isFunctional: true, ...patch })

function stand_in(rows: (url: string) => unknown, status = 200, headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; key: string | null }> = []
  const fetcher = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), key: new Headers(init?.headers).get('x-api-key') })
    return new Response(JSON.stringify(rows(String(input))), { status, headers })
  }) as unknown as typeof fetch
  return { calls, fetcher }
}

test('price overlay: only rows its documentation says to trust', () => {
  const parsed = parseOverlay([
    row(1, 100, ago(3)),
    row(2, 100, ago(3), { haveMarketData: false }),
    row(3, 100, ago(3), { bannedOnFlea: true }),
    row(4, 100, ago(3), { isFunctional: false }),
    row(5, 0, ago(3)),
    row(6, 100, ''),
    row(7, 100, ago(-60)),
    row(8, 100, ago(3), { bsgId: 'not an id' }),
    row(9, 100, ago(3), { avg24hPrice: 0 }),
  ], NOW)
  assert.deepEqual([...parsed.keys()], [id(1), id(9)])
  assert.deepEqual(parsed.get(id(1)), { price: 100, avg24hPrice: 101, renewed: NOW - 3 * MINUTE })
  assert.equal(parsed.get(id(9))!.avg24hPrice, undefined)
  assert.equal(parseOverlay({ error: 'Access denied' }, NOW).size, 0)
})

test('price overlay: no key, no request at all', async () => {
  const { calls, fetcher } = stand_in(() => [])
  const overlay = new PriceOverlay({ readKey: async () => null, fetch: fetcher, now: () => new Date(NOW) })
  assert.equal(await overlay.prices('regular'), null)
  assert.equal(calls.length, 0)
})

test('price overlay: the key goes in a header only, each mode has its own list, within its documented limits', async () => {
  const { calls, fetcher } = stand_in(() => [row(1, 100, ago(1))])
  let now = NOW
  const overlay = new PriceOverlay({ readKey: async () => KEY, fetch: fetcher, now: () => new Date(now) })
  for (const mode of ['regular', 'pve', 'pvp-season'] as const) assert.ok(await overlay.prices(mode))
  assert.deepEqual(calls.map((call) => call.url), ['https://api.tarkov-market.app/api/v1/items/all', 'https://api.tarkov-market.app/api/v1/pve/items/all', 'https://api.tarkov-market.app/api/v1/season/items/all'])
  assert.ok(calls.every((call) => call.key === KEY && !call.url.includes(KEY)))
  // Every minute the mirror asks; the source is asked once in 5 minutes per mode: 3 requests per 5 minutes against its 5 a minute.
  for (let minute = 1; minute <= 4; minute++) {
    now = NOW + minute * MINUTE
    for (const mode of ['regular', 'pve', 'pvp-season'] as const) assert.ok(await overlay.prices(mode))
  }
  assert.equal(calls.length, 3)
  now = NOW + 5 * MINUTE
  for (const mode of ['regular', 'pve', 'pvp-season'] as const) await overlay.prices(mode)
  assert.equal(calls.length, 6)
})

test('price overlay: a failure keeps the last prices for a while, then none, and the key stays out of the log', async () => {
  let failing = false
  const logs: string[] = []
  const fetcher = (async () => {
    if (failing) throw new Error(`connect failed https://api.tarkov-market.app/api/v1/items/all ${KEY}`)
    return new Response(JSON.stringify([row(1, 100, ago(1))]), { status: 200 })
  }) as unknown as typeof fetch
  let now = NOW
  const overlay = new PriceOverlay({ readKey: async () => KEY, fetch: fetcher, now: () => new Date(now), log: (message) => logs.push(message) })
  assert.ok(await overlay.prices('regular'))
  failing = true
  now = NOW + 6 * MINUTE
  assert.ok(await overlay.prices('regular'), 'the last good ones')
  now = NOW + 31 * MINUTE
  assert.equal(await overlay.prices('regular'), null, 'too old to lay over anything')
  assert.ok(logs.length >= 1)
  assert.ok(logs.every((line) => !line.includes(KEY) && !line.includes('tarkov-market')), logs.join('\n'))
})

test('price overlay: a refused key rests an hour, «over the limit» waits as long as it is told', async () => {
  const logs: string[] = []
  const refused = stand_in(() => ({ error: 'Access denied' }), 401)
  let now = NOW
  const overlay = new PriceOverlay({ readKey: async () => KEY, fetch: refused.fetcher, now: () => new Date(now), log: (message) => logs.push(message) })
  assert.equal(await overlay.prices('regular'), null)
  now = NOW + 30 * MINUTE
  await overlay.prices('pve')
  assert.equal(refused.calls.length, 1, 'no other mode asks either')
  now = NOW + 61 * MINUTE
  await overlay.prices('regular')
  assert.equal(refused.calls.length, 2)
  assert.ok(logs.every((line) => !line.includes(KEY)))

  const limited = stand_in(() => ({ error: 'limit' }), 429, { 'retry-after': '600' })
  now = NOW
  const patient = new PriceOverlay({ readKey: async () => KEY, fetch: limited.fetcher, now: () => new Date(now) })
  await patient.prices('regular')
  now = NOW + 6 * MINUTE
  await patient.prices('regular')
  assert.equal(limited.calls.length, 1)
  now = NOW + 10 * MINUTE
  await patient.prices('regular')
  assert.equal(limited.calls.length, 2)
})

test('price overlay: the key comes from the environment or a file, and a new file needs no restart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'raidos-overlay-')); t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'key.txt')
  assert.equal(await overlayKeyFrom({})(), null)
  assert.equal(await overlayKeyFrom({ RAIDOS_MARKET_API_KEY: ` ${KEY} ` })(), KEY)
  const fromFile = overlayKeyFrom({ RAIDOS_MARKET_API_KEY_FILE: file })
  assert.equal(await fromFile(), null, 'no such file yet')
  await writeFile(file, `${KEY}\n`)
  assert.equal(await fromFile(), KEY)
})

test('price mirror: the fresher price of the two wins, item by item', () => {
  const renewed = new Map<string, number>()
  const snapshot = normalizePrices({ data: { items: [
    { id: id(1), lastLowPrice: 1000, avg24hPrice: 1100, low24hPrice: 900, updated: ago(40) },
    { id: id(2), lastLowPrice: 2000, avg24hPrice: 2100, updated: ago(2) },
    { id: id(3), lastLowPrice: 3000, updated: ago(40), types: ['noFlea'] },
    { id: id(4), avg24hPrice: 4100 },
  ] } }, 'pve', 'json', new Date(NOW).toISOString(), renewed)
  const overlay = parseOverlay([row(1, 1500, ago(5)), row(2, 2500, ago(9)), row(3, 3500, ago(1)), row(4, 4500, ago(4)), row(5, 5500, ago(1))], NOW)
  assert.equal(applyPriceOverlay(snapshot, overlay, renewed), 2)
  assert.deepEqual(snapshot.items[id(1)], { lastLowPrice: 1500, avg24hPrice: 1501, low24hPrice: 900 })
  assert.equal(snapshot.items[id(2)]!.lastLowPrice, 2000, 'ours was fresher')
  assert.equal(snapshot.items[id(3)]!.lastLowPrice, 3000, 'not on the market')
  assert.equal(snapshot.items[id(4)]!.lastLowPrice, 4500, 'had no offer at the other source')
  assert.equal(snapshot.items[id(5)], undefined, 'an item the app does not know')
  assert.equal(snapshot.pricesAt, ago(2), 'the newest price of all')
  assert.equal(applyPriceOverlay(normalizePrices({ data: { items: [{ id: id(1), lastLowPrice: 1, updated: ago(1) }] } }, 'pve', 'json', new Date(NOW).toISOString(), new Map([[id(1), NOW - MINUTE]])), overlay, new Map([[id(1), NOW - MINUTE]])), 0)
})

async function mirrorSetup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'raidos-prices-overlay-')); t.after(() => rm(root, { recursive: true, force: true }))
  const storage = new MirrorStorage({ root, minFreeBytes: 1, freeBytes: async () => 10_000 })
  const devPrice = { regular: 39_999, pve: 30_000, 'pvp-season': 34_444 } as Record<string, number>
  const tarkovDev = (async (input: unknown) => {
    const url = String(input)
    const mode = /api\.tarkov\.dev/.test(url) ? 'regular' : /json\.tarkov\.dev\/([^/]+)/.exec(url)![1]!
    const rows = [{ id: id(1), lastLowPrice: devPrice[mode], updated: ago(60) }]
    return new Response(JSON.stringify(mode === 'regular' && /api\.tarkov\.dev/.test(url) ? rows : { data: { items: rows, fleaMarket: { enabled: true } } }), { status: 200 })
  }) as unknown as typeof fetch
  const saved = async (mode: string) => JSON.parse((await storage.read(`prices-${mode}`, 'prices.json'))!.toString()) as PriceSnapshot
  return { storage, tarkovDev, saved }
}

test('price mirror: with no overlay, or a source that is down, tarkov.dev\'s prices stand and nothing fails', async (t) => {
  const { storage, tarkovDev, saved } = await mirrorSetup(t)
  const down = (async () => new Response('down', { status: 500 })) as unknown as typeof fetch
  const logs: string[] = []
  const mirror = new PriceMirror({ storage, fetch: tarkovDev, minimumItems: 1, now: () => new Date(NOW), log: (message) => logs.push(message), overlay: new PriceOverlay({ readKey: async () => KEY, fetch: down, now: () => new Date(NOW), log: (message) => logs.push(message) }) })
  await mirror.run()
  assert.equal(mirror.status().state, 'done')
  assert.equal((await saved('regular')).items[id(1)]!.lastLowPrice, 39_999)
  assert.equal((await saved('pve')).items[id(1)]!.lastLowPrice, 30_000)
  assert.equal(mirror.status().modes.regular?.overlaid, 0)
  assert.ok(logs.every((line) => !line.includes(KEY)))
})

test('price mirror: each mode gets its own list, the app reads it from the same file, and no trace of the source reaches it', async (t) => {
  const { storage, tarkovDev, saved } = await mirrorSetup(t)
  const lists = { '/pve/': 31_000, '/season/': 35_000 } as Record<string, number>
  const market = stand_in((url) => {
    const price = Object.entries(lists).find(([path]) => url.includes(path))?.[1] ?? 41_000
    return [row(1, price, ago(4))]
  })
  const mirror = new PriceMirror({ storage, fetch: tarkovDev, minimumItems: 1, now: () => new Date(NOW), overlay: new PriceOverlay({ readKey: async () => KEY, fetch: market.fetcher, now: () => new Date(NOW) }) })
  await mirror.run()
  assert.equal((await saved('regular')).items[id(1)]!.lastLowPrice, 41_000)
  assert.equal((await saved('pve')).items[id(1)]!.lastLowPrice, 31_000)
  assert.equal((await saved('pvp-season')).items[id(1)]!.lastLowPrice, 35_000)
  assert.equal((await saved('pve')).pricesAt, ago(4))
  assert.equal(mirror.status().modes.pve?.overlaid, 1)
  for (const text of [JSON.stringify(await saved('pve')), JSON.stringify(mirror.status())]) {
    assert.ok(!/market\.(app|com)|tarkov-market/i.test(text), text)
    assert.ok(!text.includes(KEY))
  }
})
