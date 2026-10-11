import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DataGateway } from './dataGateway.js'
import { MirrorStorage } from './mirrorStorage.js'
import { MIRROR_ENDPOINTS, TarkovDataMirror } from './tarkovDataMirror.js'

async function setup(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'raidos-data-mirror-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return new MirrorStorage({ root, minFreeBytes: 1, freeBytes: async () => 10_000 })
}

function payload(name: string, mode: string, count = 2) {
  const base = name.split('_')[0]!
  const rows = Object.fromEntries(Array.from({ length: count }, (_, index) => [`${mode}-${index}`, { id: `${mode}-${index}` }]))
  return JSON.stringify({ data: { [base]: rows, mode } })
}

test('data mirror: publishes all modes separately and gateway serves disk while upstream is down', async (t) => {
  const storage = await setup(t)
  const calls: string[] = []
  const fetcher: typeof fetch = async (input) => {
    const url = String(input); calls.push(url)
    const [, mode, name] = /json\.tarkov\.dev\/([^/]+)\/([^/?]+)/.exec(url)!
    return new Response(payload(name!, mode!), { status: 200, headers: { etag: `"${mode}-${name}"`, 'content-length': '20' } })
  }
  const mirror = new TarkovDataMirror({ storage, fetch: fetcher, minimums: { items: 1, tasks: 1, maps: 1 } })
  await mirror.run()
  assert.equal(mirror.status().state, 'done')
  assert.ok(calls.length > MIRROR_ENDPOINTS.length * 3)
  const gateway = new DataGateway({ mirror: storage, fetch: async () => { throw new Error('offline') } })
  assert.match(await gateway.json('regular/items'), /regular-0/)
  assert.match(await gateway.json('pve/items'), /pve-0/)
  assert.match(await gateway.json('pvp-season/items'), /pvp-season-0/)
})

test('data mirror: incomplete update keeps the previous generation', async (t) => {
  const storage = await setup(t)
  let broken = false
  const fetcher: typeof fetch = async (input) => {
    const [, mode, name] = /json\.tarkov\.dev\/([^/]+)\/([^/?]+)/.exec(String(input))!
    const count = broken && mode === 'pve' && name === 'items' ? 0 : 2
    return new Response(payload(name!, mode!, count), { status: 200 })
  }
  const mirror = new TarkovDataMirror({ storage, fetch: fetcher, minimums: { items: 1, tasks: 1, maps: 1 } })
  await mirror.run()
  const before = (await storage.active()).slots['dataset-pve']!.current
  broken = true
  await mirror.run()
  assert.equal(mirror.status().state, 'degraded')
  assert.equal((await storage.active()).slots['dataset-pve']!.current, before)
})

test('data mirror: 304 reuses the previous verified body', async (t) => {
  const storage = await setup(t)
  let second = false
  const fetcher: typeof fetch = async (input, init) => {
    const [, mode, name] = /json\.tarkov\.dev\/([^/]+)\/([^/?]+)/.exec(String(input))!
    const headers = new Headers(init?.headers)
    if (second && headers.get('if-none-match')) return new Response(null, { status: 304, headers: { etag: headers.get('if-none-match')! } })
    return new Response(payload(name!, mode!), { status: 200, headers: { etag: `"${mode}-${name}"` } })
  }
  const mirror = new TarkovDataMirror({ storage, fetch: fetcher, minimums: { items: 1, tasks: 1, maps: 1 } })
  await mirror.run(); second = true; await mirror.run()
  assert.equal(mirror.status().state, 'done')
  assert.match((await storage.read('dataset-pvp-season', 'items.json'))!.toString(), /pvp-season-0/)
})
