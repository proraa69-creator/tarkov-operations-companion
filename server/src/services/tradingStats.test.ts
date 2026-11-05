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
import { parseScans, TradingStats, tradingCandidates, tradingModules } from './tradingStats.js'

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
      key: { ...worn, id: 'key', types: ['keys'], properties: { uses: 20 } },
      tank: { ...worn, id: 'tank', properties: { units: 100 } },
      kit: { ...worn, id: 'kit', types: [], categories: ['616eb7aea207f41933308f46'] },
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

const MODULE = '5c0548ae0db834001966a3c2'
const SPARE = '5c0548ae0db834001966a3c3'
const MECHANIC = '5a7c2eca46aef81a7ca2145d'
const moduleItems = {
  data: {
    fleaMarket: { sellOfferFeeRate: 0.05, sellRequirementFeeRate: 0.05 },
    items: {
      [MODULE]: { id: MODULE, types: ['mods'], basePrice: 20_000, lastLowPrice: 95_000, lastOfferCount: 7, minLevelForFlea: 20, buyFromTrader: [{ trader: 'mechanic', priceRUB: 10_573, minTraderLevel: 4, taskUnlock: 'quest', buyLimit: 1 }, { trader: 'barter', priceRUB: 0 }] },
      [SPARE]: { id: SPARE, types: ['mods'], basePrice: 20_000, lastLowPrice: 90_000, buyFromTrader: [{ trader: 'skier', priceRUB: 9000, minTraderLevel: 2 }] },
      pistolgrip: { id: 'pistolgrip', types: ['mods'], basePrice: 20_000, buyFromTrader: [{ trader: 'skier', priceRUB: 9000, minTraderLevel: 2 }] },
      grip: { id: 'grip', types: ['mods'], categories: ['55818a684bdc2ddd698b456d'], basePrice: 20_000, buyFromTrader: [{ trader: 'skier', priceRUB: 9000, minTraderLevel: 2 }] },
      magazine: { id: 'magazine', types: ['mods'], categories: ['5448bc234bdc2d3c308b4569'], basePrice: 20_000, buyFromTrader: [{ trader: 'skier', priceRUB: 9000, minTraderLevel: 2 }] },
      flashlight: { id: 'flashlight', types: ['mods'], categories: ['55818b164bdc2ddc698b456c'], basePrice: 20_000, buyFromTrader: [{ trader: 'skier', priceRUB: 9000, minTraderLevel: 2 }] },
      'ak-zenit': { id: 'ak-zenit', types: ['mods'], normalizedName: 'ak-zenit-b-33-dust-cover', basePrice: 20_000, buyFromTrader: [{ trader: 'skier', priceRUB: 9000, minTraderLevel: 2 }] },
      'pk-zenit': { id: 'pk-zenit', types: ['mods'], normalizedName: 'pk-zenit-dtk-1p-762x54r-muzzle-brake', basePrice: 20_000, buyFromTrader: [{ trader: 'skier', priceRUB: 9000, minTraderLevel: 2 }] },
      banned: { id: 'banned', types: ['mods', 'noFlea'], basePrice: 20_000, buyFromTrader: [{ trader: 'skier', priceRUB: 9000, minTraderLevel: 2 }] },
      nobody: { id: 'nobody', types: ['mods'], basePrice: 20_000, buyFromTrader: [] },
    },
  },
}
const moduleTasks = { data: { tasks: {
  q1: { id: 'q1', trader: MECHANIC, objectives: [{ type: 'buildWeapon', containsAll: [MODULE, 'banned', 'nobody'], containsCategory: ['any-sight'] }, { type: 'shoot', containsAll: [SPARE] }] },
  q2: { id: 'q2', trader: MECHANIC, objectives: [{ type: 'buildWeapon', containsAll: [MODULE] }] },
} } }

test('trading: modules are the parts a build names by itself, that a trader sells and the market lets through', () => {
  assert.deepEqual(tradingModules(moduleItems, moduleTasks), [{ id: MODULE, base: 20_000, level: 20, offers: [{ traderId: 'mechanic', price: 10_573, level: 4, questId: 'quest', limit: 1 }], questIds: ['q1', 'q2'] }])
  assert.deepEqual(tradingModules(moduleItems, { data: { tasks: {} } }), [])
})

test('trading: only the Mechanic\'s builds, without what can be swapped for another or what every player has (owner, 05.11.2026)', () => {
  const tasks = { data: { tasks: {
    other: { id: 'other', trader: 'prapor', objectives: [{ type: 'buildWeapon', containsAll: ['pistolgrip'] }] },
    parts: { id: 'parts', trader: MECHANIC, objectives: [{ type: 'buildWeapon', containsAll: ['grip', 'magazine', 'flashlight', 'ak-zenit', 'pk-zenit'] }] },
  } } }
  assert.deepEqual(tradingModules(moduleItems, tasks).map((module) => module.id), ['pk-zenit'])
})

test('trading: modules come with the file and their prices, asked for at every pass, once each', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'raidos-trading-modules-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const storage = new MirrorStorage({ root, minFreeBytes: 1, freeBytes: async () => 100_000_000 })
  for (const mode of ['regular', 'pve', 'pvp-season']) {
    const transaction = await storage.begin(`dataset-${mode}`)
    await transaction.write('items.json', JSON.stringify(moduleItems))
    await transaction.write('tasks.json', JSON.stringify(moduleTasks))
    await transaction.publish({ mode })
  }
  const urls: string[] = []
  let now = NOW
  const stats = new TradingStats({ storage, now: () => now, spacingMs: 0, sleep: async () => undefined, fetch: (async (url: string) => { urls.push(url); return Response.json(history(url.split('/').pop()!)) }) as unknown as typeof fetch })
  await stats.run()
  const file = JSON.parse((await storage.read('trading-regular', 'trading.json'))!.toString('utf8'))
  assert.equal(file.modules.length, 1)
  assert.equal(file.modules[0].id, MODULE)
  assert.ok(file.modules[0].series.length >= 84)
  assert.equal(file.modules[0].w7.max, 100_000)
  assert.equal(urls.filter((url) => url.startsWith('https://json.tarkov.dev/regular/') && url.endsWith(MODULE)).length, 1)
  urls.length = 0
  now = new Date(NOW.getTime() + 6 * HOUR)
  await stats.run()
  assert.ok(urls.some((url) => url.endsWith(MODULE)), 'between the daily passes too')
})
