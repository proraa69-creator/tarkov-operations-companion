import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AppDataset, RaidMode } from '../../../src/domain/types'
import { CATALOG_FRESH_MS, CATALOG_MAX_STALE_MS, CATALOG_RETRY_MS, createCatalogCache, isUsableCatalog } from './catalogCache.js'

const catalog = (mode: RaidMode, quests: string[], bossChance = 0.4): AppDataset => ({
  maps: [{ id: 'interchange', name: 'Развязка', subtitle: '', raidTime: 40, players: '', difficulty: '', accent: '', markerCount: 1 }],
  markers: [{ id: `interchange-boss-killa-0`, mapId: 'interchange', type: 'boss', title: 'Килла', description: '', position: [0, 0], boss: { key: 'killa', name: 'Килла', spawnChance: bossChance } }],
  quests: quests.map((id) => ({ id, name: id, trader: 'Прапор', mapIds: [], level: 1, kappa: false, description: '', objectives: [], rewards: [] })),
  items: [{ id: 'gas', name: 'Газоанализатор', shortName: 'Газ', category: 'Бартер', description: '', prices: [] }],
  hideout: [],
  traders: [],
  metadata: { source: 'json.tarkov.dev', mode, loadedAt: '2026-10-06T00:00:00.000Z', counts: {} },
}) as unknown as AppDataset

function harness() {
  let clock = 1_000_000
  const answers: Array<AppDataset | Error> = []
  const calls: string[] = []
  const cache = createCatalogCache(async (mode, locale) => {
    calls.push(`${mode}:${locale}`)
    const next = answers.shift()
    if (!next || next instanceof Error) throw next ?? new Error('tarkov.dev недоступен')
    return next
  }, () => clock)
  return { cache, answers, calls, advance: (ms: number) => { clock += ms } }
}

test('catalog cache: a new quest appears after the refresh period, served without waiting for tarkov.dev', async () => {
  const { cache, answers, calls, advance } = harness()
  answers.push(catalog('pvp', ['q1']))
  assert.deepEqual((await cache.get('pvp')).quests.map((quest) => quest.id), ['q1'])
  assert.deepEqual((await cache.get('pvp')).quests.map((quest) => quest.id), ['q1'])
  assert.equal(calls.length, 1)
  advance(CATALOG_FRESH_MS + 1)
  answers.push(catalog('pvp', ['q1', 'q2-new']))
  // The old copy now, the refresh in the background; the next request has the new quest.
  assert.deepEqual((await cache.get('pvp')).quests.map((quest) => quest.id), ['q1'])
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual((await cache.get('pvp')).quests.map((quest) => quest.id), ['q1', 'q2-new'])
  assert.equal(calls.length, 2)
})

test('catalog cache: tarkov.dev down or an empty answer keeps the last good snapshot, retried with back-off', async () => {
  const { cache, answers, calls, advance } = harness()
  answers.push(catalog('pve', ['q1']))
  await cache.get('pve')
  advance(CATALOG_MAX_STALE_MS + 1)
  answers.push(new Error('HTTP 502'))
  const down = await cache.get('pve')
  assert.deepEqual(down.quests.map((quest) => quest.id), ['q1'])
  assert.equal(down.metadata?.source, 'cache')
  // Within the back-off nobody asks tarkov.dev again.
  advance(CATALOG_RETRY_MS[0] - 1)
  assert.equal((await cache.get('pve')).metadata?.source, 'cache')
  assert.equal(calls.length, 2)
  // An empty catalog is a failure too, not the new truth.
  advance(2)
  answers.push(catalog('pve', []))
  assert.deepEqual((await cache.get('pve')).quests.map((quest) => quest.id), ['q1'])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.length, 3)
  advance(CATALOG_RETRY_MS[1] + 1)
  answers.push(catalog('pve', ['q1', 'q2']))
  await cache.get('pve')
  await new Promise((resolve) => setImmediate(resolve))
  const back = await cache.get('pve')
  assert.deepEqual(back.quests.map((quest) => quest.id), ['q1', 'q2'])
  assert.equal(back.metadata?.source, 'json.tarkov.dev')
})

test('catalog cache: nothing loaded and tarkov.dev down is an error', async () => {
  const { cache, answers } = harness()
  answers.push(new Error('offline'))
  await assert.rejects(cache.get('pvp'), /offline/)
  assert.equal(isUsableCatalog(undefined), false)
})

test('catalog cache: PvP and PvE are separate entries; a catalog labelled with another mode is refused', async () => {
  const { cache, answers, calls } = harness()
  answers.push(catalog('pvp', ['q1'], 0.4), catalog('pve', ['q1'], 1))
  const pvp = await cache.get('pvp')
  const pve = await cache.get('pve')
  assert.deepEqual(calls, ['pvp:ru', 'pve:ru'])
  assert.equal(pvp.markers[0].boss?.spawnChance, 0.4)
  assert.equal(pve.markers[0].boss?.spawnChance, 1)
  answers.push(catalog('pvp', ['q1']))
  await assert.rejects(cache.get('seasonal'), /другого режима/)
})
