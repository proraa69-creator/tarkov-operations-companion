import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { GUNS_QUERY } from '../../../src/arsenal/gunQueries.js'
import { DataGateway, GatewayError, graphqlSnapshotIdentity } from './dataGateway.js'
import { LegacyGraphqlBuilder } from './legacyGraphqlBuilder.js'
import { applicationGraphqlRequests } from './legacyGraphqlRegistry.js'
import { MirrorStorage } from './mirrorStorage.js'

const gun = '5447a9cd4bdc2dbd208b4567'
const ammo = '54527ac44bdc2d36668b4567'

async function publish(storage: MirrorStorage, slot: string, files: Record<string, unknown>) {
  const transaction = await storage.begin(slot)
  for (const [name, value] of Object.entries(files)) await transaction.write(name, JSON.stringify(value))
  await transaction.publish()
}

async function setup(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'raidos-legacy-gql-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const storage = new MirrorStorage({ root, minFreeBytes: 1, freeBytes: async () => 10_000_000 })
  for (const mode of ['regular', 'pve'] as const) {
    const items = { data: { items: {
      [gun]: { id: gun, name: 'Gun', shortName: 'Gun', types: ['gun'], properties: { propertiesType: 'ItemPropertiesWeapon', caliber: 'Caliber556x45NATO', slots: [], defaultAmmo: ammo } },
      [ammo]: { id: ammo, name: 'Ammo', shortName: 'Ammo', types: ['ammo'], properties: { propertiesType: 'ItemPropertiesAmmo', caliber: 'Caliber556x45NATO', damage: 49, penetrationPower: 44 } },
    }, fleaMarket: { enabled: true } } }
    const names = { data: { [`${gun} Name`]: `${mode} gun`, [`${ammo} Name`]: `${mode} ammo` } }
    await publish(storage, `dataset-${mode}`, {
      'items.json': items, 'items_ru.json': names, 'items_en.json': names,
      'traders.json': { data: { traders: {} } }, 'traders_ru.json': { data: {} }, 'traders_en.json': { data: {} },
      'hideout_ru.json': { data: {} }, 'hideout_en.json': { data: {} }, 'barters.json': { data: [] }, 'crafts.json': { data: [] },
      'maps.json': { data: { maps: {}, mobs: {} } },
    })
    await publish(storage, `prices-${mode}`, { 'prices.json': { mode, items: { [gun]: { lastLowPrice: mode === 'regular' ? 100 : 200 } }, fleaMarket: { enabled: true } } })
  }
  return storage
}

test('legacy GraphQL registry has stable, unique disk identities', () => {
  const requests = applicationGraphqlRequests()
  assert.equal(requests.length, 33)
  assert.equal(new Set(requests.map((row) => graphqlSnapshotIdentity(row.query, row.variables).slot)).size, requests.length)
})

test('legacy GraphQL builder creates every snapshot locally and strict gateway serves it offline', async (t) => {
  const storage = await setup(t)
  const builder = new LegacyGraphqlBuilder({ storage })
  await builder.run()
  assert.deepEqual(builder.status(), { state: 'done', total: 33, ready: 33, failed: 0, startedAt: builder.status().startedAt, finishedAt: builder.status().finishedAt })
  let fetches = 0
  const gateway = new DataGateway({ mirror: storage, strict: true, fetch: async () => { fetches += 1; throw new Error('network forbidden') } })
  const response = JSON.parse(await gateway.graphql(GUNS_QUERY, { lang: 'ru', gameMode: 'regular' })) as { data: { items: Array<{ name: string; lastLowPrice: number }> } }
  assert.equal(response.data.items[0]!.name, 'regular gun')
  assert.equal(response.data.items[0]!.lastLowPrice, 100)
  await assert.rejects(gateway.graphql('{ tasks { id } }', undefined), (error: GatewayError) => error.status === 503)
  assert.equal(fetches, 0)
  assert.equal(gateway.upstreamInFlight, 0)
})
