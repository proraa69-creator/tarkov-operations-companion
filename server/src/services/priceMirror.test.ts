import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MirrorStorage } from './mirrorStorage.js'
import { normalizePrices, PriceMirror } from './priceMirror.js'

const id = (n: number) => `${n}`.padStart(24, 'a')
const payload = (mode: string, price: number) => ({ data: { fleaMarket: { enabled: true, sellOfferFeeRate: 0.05 }, items: [{ id: id(1), lastLowPrice: price, avg24hPrice: price + 1, types: [] }] }, mode })

test('price mirror: keeps three independent economies', () => {
  assert.equal(normalizePrices(payload('regular', 10), 'regular', 'graphql', 'now').items[id(1)]!.lastLowPrice, 10)
  assert.equal(normalizePrices(payload('pve', 20), 'pve', 'graphql', 'now').items[id(1)]!.lastLowPrice, 20)
  assert.equal(normalizePrices(payload('pvp-season', 30), 'pvp-season', 'json', 'now').items[id(1)]!.lastLowPrice, 30)
})

test('price mirror: falls back to JSON for PvP/PvE and preserves last good mode snapshot', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'raidos-prices-')); t.after(() => rm(root, { recursive: true, force: true }))
  const storage = new MirrorStorage({ root, minFreeBytes: 1, freeBytes: async () => 10_000 })
  let brokenSeason = false
  const fetcher: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('/graphql')) return new Response('{"errors":["down"]}', { status: 422 })
    const mode = /json\.tarkov\.dev\/([^/]+)/.exec(url)![1]!
    if (brokenSeason && mode === 'pvp-season') return new Response('down', { status: 503 })
    const rows = Array.from({ length: 2 }, (_, index) => ({ id: id(index + 1), lastLowPrice: mode === 'regular' ? 10 : mode === 'pve' ? 20 : 30, types: [] }))
    return new Response(JSON.stringify({ data: { items: rows, fleaMarket: { enabled: true } } }), { status: 200, headers: { 'content-length': String(JSON.stringify(rows).length) } })
  }
  const mirror = new PriceMirror({ storage, fetch: fetcher, minimumItems: 1 })
  await mirror.run()
  assert.equal(mirror.status().state, 'done')
  const before = (await storage.active()).slots['prices-pvp-season']!.current
  brokenSeason = true
  await mirror.run()
  assert.equal(mirror.status().state, 'degraded')
  assert.equal((await storage.active()).slots['prices-pvp-season']!.current, before)
  assert.match((await storage.read('prices-pve', 'prices.json'))!.toString(), /"lastLowPrice":20/)
})
