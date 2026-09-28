import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { createGoonsRouter } from './goons.js'
import { MemoryGoonStore, summarizeGoons } from '../services/goonStore.js'

async function withApi(run: (api: { get: (mode: string) => Promise<Response>; post: (mode: string, body: unknown, ip?: string) => Promise<Response>; advance: (ms: number) => void }) => Promise<void>) {
  let clock = Date.parse('2026-09-28T10:00:00.000Z')
  const app = express()
  app.set('trust proxy', true) // lets the test pose as different clients through X-Forwarded-For
  app.use('/v1/goons', createGoonsRouter(new MemoryGoonStore(), { now: () => clock }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/goons`
  try {
    await run({
      get: (mode) => fetch(`${base}/${mode}`),
      post: (mode, body, ip = '10.0.0.1') => fetch(`${base}/${mode}/sightings`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) }),
      advance: (ms) => { clock += ms },
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test('goons: stores sightings with server time, keeps modes apart and summarizes 5 hours', async () => {
  await withApi(async ({ get, post, advance }) => {
    assert.deepEqual(await (await get('pvp')).json(), { latest: null, last5h: [] })
    const first = await post('pvp', { mapId: 'woods', reportedAt: '2001-01-01T00:00:00.000Z' }, '10.0.0.1')
    assert.equal(first.status, 201)
    assert.equal(((await first.json()) as { accepted: boolean }).accepted, true)
    advance(10_000)
    assert.equal((await post('pvp', { mapId: 'woods' }, '10.0.0.2')).status, 201)
    advance(10_000)
    assert.equal((await post('pvp', { mapId: 'customs' }, '10.0.0.3')).status, 201)
    assert.equal((await post('pve', { mapId: 'lighthouse' }, '10.0.0.4')).status, 201)

    const pvp = await (await get('pvp')).json() as { latest: { mapId: string; reportedAt: string }; last5h: Array<{ mapId: string; count: number; lastAt: string }> }
    assert.deepEqual(pvp.latest, { mapId: 'customs', reportedAt: '2026-09-28T10:00:20.000Z' })
    assert.deepEqual(pvp.last5h, [
      { mapId: 'woods', count: 2, lastAt: '2026-09-28T10:00:10.000Z' },
      { mapId: 'customs', count: 1, lastAt: '2026-09-28T10:00:20.000Z' },
    ])
    const pve = await (await get('pve')).json() as { last5h: unknown[]; latest: { mapId: string } }
    assert.equal(pve.latest.mapId, 'lighthouse')
    assert.equal(pve.last5h.length, 1)
    assert.deepEqual(await (await get('seasonal')).json(), { latest: null, last5h: [] })

    advance(5 * 60 * 60 * 1000 + 60_000)
    const later = await (await get('pvp')).json() as { latest: { mapId: string }; last5h: unknown[] }
    assert.equal(later.latest.mapId, 'customs', 'latest survives the 5 h stats window')
    assert.deepEqual(later.last5h, [])
    advance(19 * 60 * 60 * 1000)
    assert.deepEqual(await (await get('pvp')).json(), { latest: null, last5h: [] }, 'entries older than 24 h are pruned')
  })
})

test('goons: validates mode and map', async () => {
  await withApi(async ({ get, post }) => {
    assert.equal((await get('arena')).status, 400)
    assert.equal((await post('arena', { mapId: 'woods' })).status, 400)
    assert.equal((await post('pvp', { mapId: 'factory' })).status, 400)
    assert.equal((await post('pvp', {})).status, 400)
    assert.equal((await post('pvp', { mapId: 'woods' })).status, 201, 'rejected requests do not count against the rate limit')
  })
})

test('goons: one report per minute per address and duplicate map ignored for two minutes', async () => {
  await withApi(async ({ get, post, advance }) => {
    assert.equal((await post('pvp', { mapId: 'woods' })).status, 201)
    advance(5_000)
    const duplicate = await post('pvp', { mapId: 'woods' })
    assert.equal(duplicate.status, 200)
    assert.deepEqual(((await duplicate.json()) as { accepted: boolean; reason: string }).reason, 'duplicate')
    const tooFast = await post('pve', { mapId: 'customs' })
    assert.equal(tooFast.status, 429)
    assert.ok(Number(tooFast.headers.get('retry-after')) > 0)
    assert.equal((await post('pvp', { mapId: 'customs' }, '10.0.0.9')).status, 201, 'other addresses are not limited')
    advance(60_000)
    assert.equal(((await (await post('pvp', { mapId: 'woods' })).json()) as { reason?: string }).reason, 'duplicate', 'same map still deduped within 2 minutes')
    assert.equal((await post('pvp', { mapId: 'shoreline' })).status, 201)
    advance(125_000)
    assert.equal((await post('pvp', { mapId: 'woods' })).status, 201)
    const snapshot = await (await get('pvp')).json() as { last5h: Array<{ mapId: string; count: number }> }
    assert.deepEqual(snapshot.last5h.map((row) => [row.mapId, row.count]), [['woods', 2], ['shoreline', 1], ['customs', 1]])
  })
})

test('goons store: summary ignores other modes and prunes old entries', () => {
  const store = new MemoryGoonStore()
  const now = Date.parse('2026-09-28T12:00:00.000Z')
  store.add({ mapId: 'woods', mode: 'pvp', reportedAt: '2026-09-27T11:00:00.000Z', reporter: 'a' })
  store.add({ mapId: 'customs', mode: 'pvp', reportedAt: '2026-09-28T06:00:00.000Z', reporter: 'a' })
  store.add({ mapId: 'shoreline', mode: 'seasonal', reportedAt: '2026-09-28T11:00:00.000Z', reporter: 'b' })
  assert.deepEqual(summarizeGoons(store, 'pvp', now), { latest: { mapId: 'customs', reportedAt: '2026-09-28T06:00:00.000Z' }, last5h: [] })
  store.prune(now - 24 * 60 * 60 * 1000)
  assert.equal(store.list('pvp', 0).length, 1)
  assert.equal(store.lastByReporter('b')?.mapId, 'shoreline')
})
