import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AppDataset, RaidMode } from '../../../src/domain/types'
import { catalogEtag, catalogNotModified, hashWithoutLoadedAt, isUsableCatalog } from './catalogCache.js'

// The build schedule, the last good base and the mode separation: services/questBase.test.ts.

const catalog = (mode: RaidMode, quests: string[], bossChance = 0.4): AppDataset => ({
  maps: [{ id: 'interchange', name: 'Развязка', subtitle: '', raidTime: 40, players: '', difficulty: '', accent: '', markerCount: 1 }],
  markers: [{ id: `interchange-boss-killa-0`, mapId: 'interchange', type: 'boss', title: 'Килла', description: '', position: [0, 0], boss: { key: 'killa', name: 'Килла', spawnChance: bossChance } }],
  quests: quests.map((id) => ({ id, name: id, trader: 'Прапор', mapIds: [], level: 1, kappa: false, description: '', objectives: [], rewards: [] })),
  items: [{ id: 'gas', name: 'Газоанализатор', shortName: 'Газ', category: 'Бартер', description: '', prices: [] }],
  hideout: [],
  traders: [],
  metadata: { source: 'json.tarkov.dev', mode, loadedAt: '2026-10-06T00:00:00.000Z', counts: {} },
}) as unknown as AppDataset

test('catalog ETag: the same content keeps it whatever its loadedAt; any other change, or another mode, moves it', () => {
  const body = (data: AppDataset) => JSON.stringify(data)
  const first = catalog('pvp', ['q1'])
  const etag = catalogEtag(body(first))
  assert.match(etag, /^W\/"[a-f0-9]{40}"$/)
  // Refreshed from tarkov.dev a minute later, nothing new in it.
  assert.equal(catalogEtag(body({ ...first, metadata: { ...first.metadata!, loadedAt: '2026-10-06T00:01:00.000Z' } })), etag)
  // A new quest, a moved price, PvE instead of PvP.
  assert.notEqual(catalogEtag(body(catalog('pvp', ['q1', 'q2']))), etag)
  const priced = catalog('pvp', ['q1'])
  priced.items[0] = { ...priced.items[0]!, fleaPrice: 12_345 }
  assert.notEqual(catalogEtag(body(priced)), etag)
  assert.notEqual(catalogEtag(body(catalog('pve', ['q1']))), etag)
  // A description quoting the field is content, not the field.
  const quoting = catalog('pvp', ['q1'])
  quoting.items[0] = { ...quoting.items[0]!, description: '"loadedAt":"x"' }
  const other = catalog('pvp', ['q1'])
  other.items[0] = { ...other.items[0]!, description: '"loadedAt":"y"' }
  assert.notEqual(catalogEtag(body(quoting)), catalogEtag(body(other)))
})

test('catalog If-None-Match: weak comparison, lists and *; nothing sent, or another version, is a full answer', () => {
  const etag = 'W/"0123456789abcdef0123456789abcdef01234567"'
  assert.equal(catalogNotModified(undefined, etag), false)
  assert.equal(catalogNotModified('', etag), false)
  assert.equal(catalogNotModified(etag, etag), true)
  assert.equal(catalogNotModified('"0123456789abcdef0123456789abcdef01234567"', etag), true)
  assert.equal(catalogNotModified('W/"aaaa", W/"0123456789abcdef0123456789abcdef01234567"', etag), true)
  assert.equal(catalogNotModified('*', etag), true)
  assert.equal(catalogNotModified('W/"ffffffffffffffffffffffffffffffffffffffff"', etag), false)
})

test('catalog content hash: without loadedAt, SHA-1 for the ETag and SHA-256 for the quest base versions', () => {
  const first = catalog('pvp', ['q1'])
  const rebuilt = { ...first, metadata: { ...first.metadata!, loadedAt: '2026-10-14T12:00:00.000Z' } }
  assert.equal(hashWithoutLoadedAt(JSON.stringify(first), 'sha256'), hashWithoutLoadedAt(JSON.stringify(rebuilt), 'sha256'))
  assert.match(hashWithoutLoadedAt(JSON.stringify(first), 'sha256'), /^[a-f0-9]{64}$/)
  assert.equal(catalogEtag(JSON.stringify(first)), `W/"${hashWithoutLoadedAt(JSON.stringify(first))}"`)
  assert.notEqual(hashWithoutLoadedAt(JSON.stringify(catalog('pvp', ['q1', 'q2'])), 'sha256'), hashWithoutLoadedAt(JSON.stringify(first), 'sha256'))
  // An empty or cut catalog is never usable.
  assert.equal(isUsableCatalog(undefined), false)
  assert.equal(isUsableCatalog(catalog('pvp', [])), false)
  assert.equal(isUsableCatalog(catalog('pvp', ['q1'])), true)
})
