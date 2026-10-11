import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DataGateway } from './dataGateway.js'
import { MirrorStorage } from './mirrorStorage.js'
import { PriceHistoryMirror } from './priceHistoryMirror.js'

const itemId = '5447a9cd4bdc2dbd208b4567'

test('price history: request only queues, daily worker publishes, errors preserve the last snapshot', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'raidos-history-')); t.after(() => rm(root, { recursive: true, force: true }))
  const storage = new MirrorStorage({ root, minFreeBytes: 1, freeBytes: async () => 10_000_000 })
  let fail = false
  let fetches = 0
  const mirror = new PriceHistoryMirror({
    storage, now: () => new Date('2026-10-12T00:00:00.000Z'),
    fetch: async () => {
      fetches += 1
      return fail ? new Response('down', { status: 503 }) : Response.json({ data: [
        { timestamp: Date.parse('2026-09-01T00:00:00Z'), price: 10 },
        { timestamp: Date.parse('2026-10-11T00:00:00Z'), price: 20, priceMin: 15 },
      ] })
    },
  })
  assert.deepEqual(await mirror.request('regular', itemId), { mode: 'regular', itemId, updatedAt: null, pending: true, unavailable: false, points: [] })
  await mirror.request('regular', itemId)
  assert.equal(fetches, 0, 'a user request never contacts upstream')
  await mirror.run()
  assert.equal(fetches, 1, 'duplicate requests are one queue entry')
  assert.deepEqual((await mirror.request('regular', itemId, 30)).points, [{ timestamp: Date.parse('2026-10-11T00:00:00Z'), price: 20, priceMin: 15 }])
  await mirror.enqueue('regular', itemId); fail = true; await mirror.run()
  assert.equal(mirror.status().state, 'error')
  assert.equal((await mirror.request('regular', itemId, 30)).points.length, 1)
})

test('price history: strict legacy GraphQL reads the local service without network', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'raidos-history-gql-')); t.after(() => rm(root, { recursive: true, force: true }))
  const storage = new MirrorStorage({ root, minFreeBytes: 1, freeBytes: async () => 10_000_000 })
  const history = new PriceHistoryMirror({ storage, fetch: async () => { throw new Error('network forbidden') } })
  let fetches = 0
  const gateway = new DataGateway({ mirror: storage, strict: true, priceHistory: history, fetch: async () => { fetches += 1; throw new Error('network forbidden') } })
  const body = JSON.parse(await gateway.graphql(`{ historicalItemPrices(id: "${itemId}", days: 30, gameMode: regular) { price priceMin timestamp } }`, undefined))
  assert.deepEqual(body, { data: { historicalItemPrices: [] } })
  assert.equal(fetches, 0)
})
