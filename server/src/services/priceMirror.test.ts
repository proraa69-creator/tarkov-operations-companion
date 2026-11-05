import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MirrorStorage } from './mirrorStorage.js'
import { normalizePrices, PriceMirror, type PriceSnapshot } from './priceMirror.js'

const id = (n: number) => `${n}`.padStart(24, 'a')
const payload = (mode: string, price: number) => ({ data: { fleaMarket: { enabled: true, sellOfferFeeRate: 0.05 }, items: [{ id: id(1), lastLowPrice: price, avg24hPrice: price + 1, types: [] }] }, mode })

test('price mirror: keeps three independent economies', () => {
  assert.equal(normalizePrices(payload('regular', 10), 'regular', 'compact-rest', 'now').items[id(1)]!.lastLowPrice, 10)
  assert.equal(normalizePrices(payload('pve', 20), 'pve', 'compact-rest', 'now').items[id(1)]!.lastLowPrice, 20)
  assert.equal(normalizePrices(payload('pvp-season', 30), 'pvp-season', 'json', 'now').items[id(1)]!.lastLowPrice, 30)
})

test('price mirror: keeps when the source last renewed a price, not when we asked', () => {
  const row = (n: number, updated: string | undefined, price = 10) => ({ id: id(n), lastLowPrice: price, ...(updated ? { updated } : {}) })
  const asked = '2026-11-05T19:02:00.000Z'
  const at = (items: unknown[]) => normalizePrices({ data: { items } }, 'pve', 'json', asked).pricesAt
  assert.equal(at([row(1, '2026-11-05T18:38:03.000Z'), row(2, '2026-11-05T18:58:03.000Z'), row(3, '2026-11-05T18:48:03.000Z')]), '2026-11-05T18:58:03.000Z')
  assert.equal(at([row(1, '2026-11-05T18:38:03.000Z'), { id: id(2), updated: '2026-11-05T18:58:03.000Z' }]), '2026-11-05T18:38:03.000Z', 'an item with no offers has no price to renew')
  assert.equal(at([row(1, '2026-11-05T18:38:03.000Z'), row(2, '2026-11-06T18:38:03.000Z')]), '2026-11-05T18:38:03.000Z', 'not from the future')
  assert.equal(at([row(1, 'nonsense'), row(2, undefined)]), undefined)
  // The real routes' own shapes: the compact one is an array with `uid` and `price`.
  assert.equal(normalizePrices([{ uid: id(1), price: 10, updated: '2026-11-05T18:48:03.000Z' }], 'regular', 'compact-rest', asked).pricesAt, '2026-11-05T18:48:03.000Z')
})

test('price mirror: the compact route has PvP prices in any mode, so PvE and Season never come from it', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'raidos-prices-')); t.after(() => rm(root, { recursive: true, force: true }))
  const storage = new MirrorStorage({ root, minFreeBytes: 1, freeBytes: async () => 10_000 })
  const calls: string[] = []
  // As the real one answered on 05.11.2026: the same PvP rows at /regular/ and /pve/, the mode's own prices in the JSON files.
  const fetcher: typeof fetch = async (input) => {
    const url = String(input); calls.push(url)
    const compact = /api\.tarkov\.dev\/api\/v1\/(regular|pve)\//.test(url)
    if (url.includes('api.tarkov.dev') && !compact) return new Response('Not found', { status: 404 })
    const mode = compact ? 'regular' : /json\.tarkov\.dev\/([^/]+)/.exec(url)![1]!
    const price = mode === 'regular' ? 39_999 : mode === 'pve' ? 30_000 : 34_444
    const rows = [{ id: id(1), lastLowPrice: price, types: [] }]
    return new Response(JSON.stringify(compact ? rows : { data: { items: rows, fleaMarket: { enabled: true } } }), { status: 200 })
  }
  await new PriceMirror({ storage, fetch: fetcher, minimumItems: 1 }).run()
  const saved = async (mode: string) => JSON.parse((await storage.read(`prices-${mode}`, 'prices.json'))!.toString()) as PriceSnapshot
  assert.equal((await saved('regular')).items[id(1)]!.lastLowPrice, 39_999)
  assert.equal((await saved('pve')).items[id(1)]!.lastLowPrice, 30_000)
  assert.equal((await saved('pvp-season')).items[id(1)]!.lastLowPrice, 34_444)
  assert.equal((await saved('regular')).source, 'compact-rest')
  assert.equal((await saved('pve')).source, 'json')
  assert.deepEqual(calls.filter((url) => url.includes('api.tarkov.dev')), ['https://api.tarkov.dev/api/v1/regular/items'])
})

test('price mirror: PvP falls back to JSON, and a broken mode keeps its last good snapshot', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'raidos-prices-')); t.after(() => rm(root, { recursive: true, force: true }))
  const storage = new MirrorStorage({ root, minFreeBytes: 1, freeBytes: async () => 10_000 })
  let brokenSeason = false
  const calls: string[] = []
  const fetcher: typeof fetch = async (input) => {
    const url = String(input); calls.push(url)
    if (url.includes('/api/v1/')) return new Response('down', { status: 503 })
    const mode = /json\.tarkov\.dev\/([^/]+)/.exec(url)![1]!
    if (brokenSeason && mode === 'pvp-season') return new Response('down', { status: 503 })
    const rows = Array.from({ length: 2 }, (_, index) => ({ id: id(index + 1), lastLowPrice: mode === 'regular' ? 10 : mode === 'pve' ? 20 : 30, types: [] }))
    return new Response(JSON.stringify({ data: { items: rows, fleaMarket: { enabled: true } } }), { status: 200, headers: { 'content-length': String(JSON.stringify(rows).length) } })
  }
  const mirror = new PriceMirror({ storage, fetch: fetcher, minimumItems: 1 })
  await mirror.run()
  assert.equal(mirror.status().state, 'done')
  assert.ok(calls.some((url) => url.includes('/api/v1/regular/items')))
  assert.ok(calls.some((url) => url.includes('json.tarkov.dev/regular/items')))
  assert.ok(calls.some((url) => url.includes('json.tarkov.dev/pve/items')))
  assert.ok(calls.every((url) => !url.includes('/graphql')))
  assert.equal(JSON.parse((await storage.read('prices-regular', 'prices.json'))!.toString()).source, 'json-fallback')
  assert.equal(JSON.parse((await storage.read('prices-pve', 'prices.json'))!.toString()).source, 'json')
  const before = (await storage.active()).slots['prices-pvp-season']!.current
  brokenSeason = true
  await mirror.run()
  assert.equal(mirror.status().state, 'degraded')
  assert.equal((await storage.active()).slots['prices-pvp-season']!.current, before)
  assert.match((await storage.read('prices-pve', 'prices.json'))!.toString(), /"lastLowPrice":20/)
})
