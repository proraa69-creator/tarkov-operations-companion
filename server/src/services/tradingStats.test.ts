import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { createDataRouter } from '../routes/data.js'
import { DataGateway } from './dataGateway.js'
import { MirrorStorage } from './mirrorStorage.js'
import { parseScans, TradingStats, tradingCandidates } from './tradingStats.js'

const HOUR = 3_600_000
const NOW = new Date('2026-11-05T00:00:00.000Z')
const swinging = '5447a9cd4bdc2dbd208b4567'
const flat = '5c0530ee86f774697952d952'
const cheap = '59faff1d86f7746c51718c9c'
const banned = '62a09cfe4f842e1bd12da3e4'
const worn = { types: ['barter'], basePrice: 100_000, lastLowPrice: 90_000, lastOfferCount: 20 }
const fetchedIds = (urls: string[]) => urls.map((url) => url.split('/').pop())

const dataset = () => ({
  data: {
    fleaMarket: { sellOfferFeeRate: 0.05, sellRequirementFeeRate: 0.05 },
    items: {
      [swinging]: { id: swinging, types: ['barter'], basePrice: 100_000, lastLowPrice: 90_000, lastOfferCount: 20, minLevelForFlea: 30, width: 2, height: 2, sellToTrader: [{ priceRUB: 40_000 }, { priceRUB: 51_000 }] },
      [flat]: { id: flat, types: ['barter'], basePrice: 100_000, lastLowPrice: 90_000, lastOfferCount: 20, sellToTrader: [] },
      [cheap]: { id: cheap, types: ['barter'], basePrice: 1000, lastLowPrice: 500, lastOfferCount: 20 },
      [banned]: { id: banned, types: ['barter', 'noFlea'], basePrice: 100_000, lastLowPrice: 90_000, lastOfferCount: 20 },
      gun: { ...worn, id: 'gun', types: ['gun', 'wearable'], properties: { maxDurability: 100 } },
      vest: { ...worn, id: 'vest', types: ['wearable', 'rig'], properties: { durability: 212 } },
      shield: { ...worn, id: 'shield', types: ['glasses', 'wearable'], properties: { durability: 40 } },
    },
  },
})
const history = (id: string) => {
  const count = 30 * 12
  return { data: { prices: Array.from({ length: count }, (_, index) => ({ timestamp: NOW.getTime() - (count - 1 - index) * 2 * HOUR, price: 120_000, priceMin: id === flat ? 100_000 : index % 12 < 2 ? 60_000 : 100_000, offerCount: 20 })) } }
}

async function setup(t: TestContext, options: { fail?: () => boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'raidos-trading-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const storage = new MirrorStorage({ root, minFreeBytes: 1, freeBytes: async () => 100_000_000 })
  for (const mode of ['regular', 'pve', 'pvp-season']) {
    const transaction = await storage.begin(`dataset-${mode}`)
    await transaction.write('items.json', JSON.stringify(dataset()))
    await transaction.publish({ mode })
  }
  const urls: string[] = []
  let now = NOW
  const stats = new TradingStats({
    storage,
    now: () => now,
    spacingMs: 0,
    sleep: async () => undefined,
    fetch: (async (url: string) => {
      urls.push(url)
      if (options.fail?.()) return new Response('down', { status: 503 })
      return Response.json(history(url.split('/').pop()!))
    }) as unknown as typeof fetch,
  })
  return { storage, stats, urls, later: (ms: number) => { now = new Date(now.getTime() + ms) } }
}

test('trading: candidates are what is on the market, not too cheap, with the trader prices and the level', () => {
  const { fee, items } = tradingCandidates(dataset())
  assert.deepEqual(fee, { offerFeeRate: 0.05, requirementFeeRate: 0.05 })
  assert.deepEqual(items.map((item) => item.id).sort(), [swinging, flat].sort())
  const first = items.find((item) => item.id === swinging)!
  assert.deepEqual(first.traderPrices, [40_000, 51_000])
  assert.equal(first.level, 30)
  assert.equal(first.slots, 4)
})

test('trading: scans come from every shape of the answer, sorted, without empty ones', () => {
  const rows = [{ timestamp: 2000, priceMin: 20, offerCount: 3 }, { timestamp: 1000, priceMin: 10 }, { timestamp: 3000, price: 5 }]
  const expected = [{ timestamp: 1000, floor: 10 }, { timestamp: 2000, floor: 20, offers: 3 }]
  assert.deepEqual(parseScans({ data: rows }), expected)
  assert.deepEqual(parseScans({ data: { prices: rows } }), expected)
  assert.deepEqual(parseScans(rows), expected)
  assert.deepEqual(parseScans('nonsense'), [])
})

test('trading: one pass publishes each mode apart, one request at a time, profitable items only', async (t) => {
  const { storage, stats, urls } = await setup(t)
  await stats.run()
  assert.equal(stats.status().state, 'done')
  for (const mode of ['regular', 'pve', 'pvp-season']) {
    const file = JSON.parse((await storage.read(`trading-${mode}`, 'trading.json'))!.toString('utf8'))
    assert.equal(file.mode, mode)
    assert.equal(file.analyzed, 2)
    assert.deepEqual(file.rows.map((row: { id: string }) => row.id), [swinging], 'a flat item earns nothing')
    assert.equal(file.rows[0].level, 30)
  }
  assert.equal(urls.length, 6)
  assert.ok(urls.every((url) => /^https:\/\/json\.tarkov\.dev\/(regular|pve|pvp-season)\/prices\//.test(url)))
  assert.ok(!fetchedIds(urls).includes(banned))
  assert.ok(!fetchedIds(urls).includes(cheap))
})

test('trading: between two daily passes only the published items are asked for', async (t) => {
  const { stats, urls, later } = await setup(t)
  await stats.run()
  urls.length = 0
  later(6 * HOUR)
  await stats.run()
  assert.deepEqual(fetchedIds(urls), [swinging, swinging, swinging], 'the flat item waits for the daily pass')
  urls.length = 0
  later(18 * HOUR)
  await stats.run()
  assert.equal(urls.length, 6, 'once a day every candidate again')
})

test('trading: a source that is down keeps the last file and stops asking soon', async (t) => {
  let down = false
  const { storage, stats, urls, later } = await setup(t, { fail: () => down })
  await stats.run()
  const before = (await storage.read('trading-regular', 'trading.json'))!.toString('utf8')
  down = true
  urls.length = 0
  later(24 * HOUR)
  await stats.run()
  assert.equal(stats.status().state, 'error')
  assert.equal((await storage.read('trading-regular', 'trading.json'))!.toString('utf8'), before)
  assert.ok(stats.status().modes.regular?.error)
  assert.ok(urls.length <= 6, 'two candidates per mode, each asked once')
})

test('trading: a mode without a dataset yet does not stop the others', async (t) => {
  const { stats } = await setup(t)
  const root = await mkdtemp(join(tmpdir(), 'raidos-trading-empty-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const empty = new TradingStats({ storage: new MirrorStorage({ root, minFreeBytes: 1, freeBytes: async () => 100_000_000 }), fetch: (async () => { throw new Error('must not be asked') }) as unknown as typeof fetch, sleep: async () => undefined })
  await empty.run()
  assert.equal(empty.status().state, 'error')
  assert.match(empty.status().modes.pve?.error ?? '', /no dataset/)
  assert.equal(stats.status().state, 'idle')
})

test('trading: start waits, a pass never overlaps itself', async (t) => {
  const { stats, urls } = await setup(t)
  const first = stats.run()
  const second = stats.run()
  assert.equal(first, second)
  await first
  assert.equal(urls.length, 6)
})

test('trading: the route gives each mode its own file behind the subscription check, and costs no work', async (t) => {
  const { storage, stats, urls } = await setup(t)
  let paid = true
  const app = express()
  app.use('/v1/data', createDataRouter(new DataGateway({ mirror: storage }), (_req, res, next) => {
    if (!paid) { res.status(402).json({ error: 'Нужна подписка' }); return }
    next()
  }, storage))
  const server = app.listen(0)
  t.after(() => { server.close() })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/data/trading`
  assert.equal((await fetch(`${base}/pvp`)).status, 503, 'not built yet')
  await stats.run()
  urls.length = 0
  for (const [mode, key] of [['pvp', 'regular'], ['pve', 'pve'], ['seasonal', 'pvp-season']] as const) {
    const answer = await fetch(`${base}/${mode}`)
    assert.equal(answer.status, 200)
    assert.equal(((await answer.json()) as { mode: string }).mode, key)
  }
  assert.equal(urls.length, 0, 'a player asking never reaches tarkov.dev')
  assert.equal((await fetch(`${base}/nonsense`)).status, 404)
  paid = false
  assert.equal((await fetch(`${base}/pvp`)).status, 402)
})
