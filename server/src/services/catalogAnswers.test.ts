import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { AppDataset, RaidMode } from '../../../src/domain/types'
import { createApi } from '../app.js'
import { AccountStore, type SubscriptionSource } from './accountStore.js'
import { applyMirroredPrices, createCatalogAnswers, MirroredPrices } from './catalogAnswers.js'
import { catalogNotModified } from './catalogCache.js'
import { EntitlementService } from './entitlement.js'
import { MirrorStorage } from './mirrorStorage.js'
import type { PriceSnapshot } from './priceMirror.js'
import { ProgressStore } from './progressStore.js'

const ITEM = '5af0548586f7743a532b7e99'

function catalog(mode: RaidMode, version = 'v1'): AppDataset {
  return {
    maps: [], markers: [], hideout: [], traders: [],
    quests: [{ id: 'q1', name: 'Дефицит', trader: 'Терапевт', mapIds: [], level: 1, kappa: false, description: '', objectives: [], rewards: [] }],
    items: [{ id: ITEM, name: 'Газоанализатор', shortName: 'Газ', category: 'Бартер', description: '', prices: [] }],
    metadata: { source: 'json.tarkov.dev', mode, loadedAt: '2026-10-14T10:00:00.000Z', counts: {}, questBaseVersion: version },
  } as unknown as AppDataset
}

const prices = (mode: 'regular' | 'pve', price: number): PriceSnapshot => ({
  mode, updatedAt: new Date().toISOString(), source: 'compact-rest', fleaMarket: { enabled: true, sellOfferFeeRate: 0.05 }, items: { [ITEM]: { lastLowPrice: price } },
})

test('catalog answers: prepared once per base version, price generation and image set, per mode and language', async () => {
  const base: Record<string, AppDataset> = { 'pvp:ru': catalog('pvp'), 'pvp:en': catalog('pvp'), 'pve:ru': catalog('pve') }
  let priceVersion = 'prices-regular-1'
  let images = 'images-1'
  const answers = createCatalogAnswers({
    snapshot: async (mode, locale) => base[`${mode}:${locale}`]!,
    prices: async () => ({ version: priceVersion, snapshot: prices('regular', priceVersion.endsWith('1') ? 100 : 150) }),
    inputsVersion: () => images,
    decorate: (data, snapshot) => (snapshot ? applyMirroredPrices(data, snapshot) : data),
  })
  const first = await answers.get('pvp', 'ru')
  const again = await Promise.all([answers.get('pvp', 'ru'), answers.get('pvp', 'ru')])
  assert.equal(answers.preparations(), 1)
  assert.ok(again.every((answer) => answer === first), 'the same bytes and ETag, nothing prepared again')
  assert.match(first.etag, /^W\/"[a-f0-9]{40}"$/)
  assert.equal(catalogNotModified(first.etag, first.etag), true)
  assert.equal((JSON.parse(first.body.toString('utf8')) as AppDataset).items[0]!.fleaPrice, 100)
  assert.equal((JSON.parse(first.body.toString('utf8')) as AppDataset).metadata?.questBaseVersion, 'v1')

  // New prices: prepared again once, with a new ETag.
  priceVersion = 'prices-regular-2'
  const priced = await answers.get('pvp', 'ru')
  await answers.get('pvp', 'ru')
  assert.equal(answers.preparations(), 2)
  assert.notEqual(priced.etag, first.etag)
  assert.equal((JSON.parse(priced.body.toString('utf8')) as AppDataset).items[0]!.fleaPrice, 150)
  // Another image set, then a new base version: each prepared once again.
  images = 'images-2'
  await answers.get('pvp', 'ru')
  assert.equal(answers.preparations(), 3)
  base['pvp:ru'] = catalog('pvp', 'v2')
  const rebuilt = await answers.get('pvp', 'ru')
  assert.equal(answers.preparations(), 4)
  assert.equal((JSON.parse(rebuilt.body.toString('utf8')) as AppDataset).metadata?.questBaseVersion, 'v2')
  // English and PvE are their own answers.
  const english = await answers.get('pvp', 'en')
  const pve = await answers.get('pve', 'ru')
  assert.equal(answers.preparations(), 6)
  assert.notEqual(pve.etag, rebuilt.etag)
  assert.notEqual(english, rebuilt)
})

test('mirrored prices: the price file is read and parsed only when the mirror publishes a new generation; modes apart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'raidos-catalog-prices-')); t.after(() => rm(root, { recursive: true, force: true }))
  const storage = new MirrorStorage({ root, minFreeBytes: 1, freeBytes: async () => 10_000 })
  const publish = async (slot: string, snapshot: PriceSnapshot) => {
    const transaction = await storage.begin(slot)
    await transaction.write('prices.json', `${JSON.stringify(snapshot)}\n`)
    return transaction.publish({ mode: snapshot.mode })
  }
  const mirrored = new MirroredPrices(storage)
  assert.deepEqual(await mirrored.current('pvp'), { version: '' }, 'no prices yet: the catalog keeps its own')
  const january = prices('regular', 100)
  await publish('prices-regular', january)
  const first = await mirrored.current('pvp')
  for (let request = 0; request < 5; request += 1) assert.equal((await mirrored.current('pvp')).version, first.version)
  assert.equal(mirrored.reads(), 1)
  assert.equal(first.snapshot?.items[ITEM]?.lastLowPrice, 100)
  // The same file published again is not a new generation: nothing is read.
  assert.equal((await publish('prices-regular', january)).published, false)
  assert.equal((await mirrored.current('pvp')).version, first.version)
  assert.equal(mirrored.reads(), 1)
  // New prices: read once.
  await publish('prices-regular', prices('regular', 150))
  const second = await mirrored.current('pvp')
  await mirrored.current('pvp')
  assert.notEqual(second.version, first.version)
  assert.equal(second.snapshot?.items[ITEM]?.lastLowPrice, 150)
  assert.equal(mirrored.reads(), 2)
  // PvE reads its own slot; PvP's prices never reach it.
  assert.deepEqual(await mirrored.current('pve'), { version: '' })
  await publish('prices-pve', prices('pve', 70))
  assert.equal((await mirrored.current('pve')).snapshot?.items[ITEM]?.lastLowPrice, 70)
  assert.equal((await mirrored.current('pvp')).snapshot?.items[ITEM]?.lastLowPrice, 150)
  assert.equal(mirrored.reads(), 3)
})

test('catalog route: full answers and 304 come from the prepared bytes; the catalog is stringified once per version', async (t) => {
  let stringified = 0
  let current = catalog('pvp')
  const counted = (data: AppDataset) => Object.assign(data, { toJSON() { stringified += 1; const { toJSON: _skip, ...rest } = this as AppDataset & { toJSON?: unknown }; void _skip; return rest } })
  current = counted(current)
  const paid = new Map<string, number>()
  const accounts = new AccountStore()
  const source: SubscriptionSource = { paidUntil: (id) => paid.get(id), referralStats: () => ({ activeSubscriptions: 0, revenue: 0, earnings: 0 }), referralSeries: () => [] }
  accounts.attachSubscriptions(source)
  const entitlements = new EntitlementService(accounts)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { entitlements, catalogSnapshot: async () => current }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const token = (await accounts.register('catalog@example.com', 'correct horse battery')).token
  paid.set(accounts.authenticate(token)!, Date.now() + 86_400_000)
  const device = 'device-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const headers = { authorization: `Bearer ${token}`, 'x-raid-device': device }
  assert.equal((await fetch(`${url}/v1/entitlement`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: device }) })).status, 200)

  const full = await fetch(`${url}/v1/catalog/pvp`, { headers })
  const etag = full.headers.get('etag')!
  assert.equal(full.status, 200)
  assert.match(full.headers.get('content-type') ?? '', /^application\/json/)
  assert.deepEqual(((await full.json()) as AppDataset).quests.map((quest) => quest.id), ['q1'])
  for (let request = 0; request < 3; request += 1) {
    const cached = await fetch(`${url}/v1/catalog/pvp`, { headers: { ...headers, 'if-none-match': etag, 'cache-control': 'no-cache' } })
    assert.equal(cached.status, 304)
    assert.equal(await cached.text(), '')
  }
  // An old app sends no If-None-Match: the whole catalog, from the same bytes.
  const old = await fetch(`${url}/v1/catalog/pvp`, { headers })
  assert.equal(old.status, 200)
  assert.equal(old.headers.get('etag'), etag)
  assert.equal(Number(old.headers.get('content-length')), Buffer.byteLength(await old.text()))
  assert.equal(stringified, 1, 'one stringify for five requests')
  // A new version of the base: prepared once more, a new ETag.
  current = counted(catalog('pvp', 'v2'))
  const changed = await fetch(`${url}/v1/catalog/pvp`, { headers: { ...headers, 'if-none-match': etag } })
  assert.equal(changed.status, 200)
  assert.notEqual(changed.headers.get('etag'), etag)
  assert.equal(stringified, 2)
})

test('mirrored prices over a catalog: the flea quote the pages show is renewed too, with the price\'s own time; modes apart', () => {
  const old = '2026-11-09T18:44:00.000Z'
  const at = Math.floor(Date.parse('2026-11-09T20:31:00.000Z') / 60_000)
  const item = (id: string, prices: unknown[], extra: Record<string, unknown> = {}) => ({ id, name: id, shortName: id, category: 'Бартер', description: '', prices, ...extra })
  const flea = (mode: RaidMode, price: number, basis = 'last-low') => ({ source: 'Барахолка', kind: 'flea', mode, price, basis, updatedAt: old })
  const trader = { source: 'Терапевт', kind: 'trader', mode: 'pvp', price: 900, updatedAt: old }
  const data = {
    ...catalog('pvp'),
    items: [
      item('moved00000000000000000001', [flea('pvp', 1_387_777), trader, flea('pve', 5_000)]),
      item('lone000000000000000000002', [flea('pvp', 700_000)]),
      item('gone000000000000000000003', [flea('pvp', 40_000)], { basePrice: 12_000 }),
      item('banned0000000000000000004', [flea('pvp', 40_000), trader]),
      item('fresh00000000000000000005', [{ source: 'Базовая цена', kind: 'base', mode: 'pvp', price: 300, updatedAt: old }]),
      item('same000000000000000000006', [flea('pvp', 2_000)]),
      item('absent0000000000000000007', [flea('pvp', 1_000)]),
    ],
  } as unknown as AppDataset
  const snapshot: PriceSnapshot = {
    mode: 'regular', updatedAt: '2026-11-09T20:40:00.000Z', source: 'compact-rest', fleaMarket: { enabled: true }, items: {
      moved00000000000000000001: { lastLowPrice: 545_555, avg24hPrice: 600_000, at },
      lone000000000000000000002: { lastLowPrice: 700_000, avg24hPrice: 137_350, at },
      gone000000000000000000003: {},
      banned0000000000000000004: { lastLowPrice: 41_000, noFlea: true, at },
      fresh00000000000000000005: { avg24hPrice: 450 },
      same000000000000000000006: { lastLowPrice: 2_000 },
    },
  }
  const [moved, lone, gone, banned, fresh, same, absent] = applyMirroredPrices(data, snapshot).items as unknown as Array<{ fleaPrice?: number; fleaPriceBasis?: string; prices: Array<Record<string, unknown>> }>
  const renewed = new Date(at * 60_000).toISOString()

  // The minute price and its own time in the PvP quote; the trader and the PvE quote untouched.
  assert.deepEqual(moved!.prices, [{ source: 'Барахолка', kind: 'flea', mode: 'pvp', price: 545_555, basis: 'last-low', updatedAt: renewed }, trader, flea('pve', 5_000)])
  assert.equal(moved!.fleaPrice, 545_555)
  // A lone listing at more than twice the day's average: the average, in the quote and in fleaPrice alike.
  assert.deepEqual(lone!.prices, [{ source: 'Барахолка', kind: 'flea', mode: 'pvp', price: 137_350, basis: 'avg-24h', updatedAt: renewed }])
  assert.deepEqual([lone!.fleaPrice, lone!.fleaPriceBasis], [137_350, 'avg-24h'])
  // No flea price any more: the quote goes, the base price stands in when nothing else is left.
  assert.deepEqual(gone!.prices, [{ source: 'Базовая цена', kind: 'base', mode: 'pvp', price: 12_000, updatedAt: old }])
  assert.equal(gone!.fleaPrice, undefined)
  // Banned from the flea: no flea price whatever the file holds.
  assert.deepEqual(banned!.prices, [trader])
  assert.equal(banned!.fleaPrice, undefined)
  // A first flea price: in front, in place of «Базовая цена»; no time of its own, so when the server asked.
  assert.deepEqual(fresh!.prices, [{ source: 'Барахолка', kind: 'flea', mode: 'pvp', price: 450, basis: 'avg-24h', updatedAt: snapshot.updatedAt }])
  // The same price and no time in the file: the quote keeps the time it had.
  assert.deepEqual(same!.prices, [flea('pvp', 2_000)])
  // Not in the price file: the catalog's item as it is.
  assert.equal(absent, data.items[6])

  // PvE prices renew only the PvE quote.
  const pve = applyMirroredPrices(data, { ...snapshot, mode: 'pve', items: { moved00000000000000000001: { lastLowPrice: 6_500, at } } }).items[0]!
  assert.deepEqual(pve.prices, [flea('pvp', 1_387_777), trader, { source: 'Барахолка', kind: 'flea', mode: 'pve', price: 6_500, basis: 'last-low', updatedAt: renewed }])
})
