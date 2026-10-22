import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { MapMirror, mirrorPlan, OWN_TILES_FILE, setTileCount, tileSetPath } from './mapMirror.js'
import { createMapTilesRouter } from '../routes/mapTiles.js'
import { MirrorStorage } from './mirrorStorage.js'

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('tile')])
const MAPS = [
  { normalizedName: 'factory', maps: [{ key: 'factory', minZoom: 0, maxZoom: 1, svgPath: 'https://assets.tarkov.dev/maps/svg/Factory.svg', tilePath: 'https://assets.tarkov.dev/maps/factory/main/{z}/{x}/{y}.png',
    layers: [{ name: '2nd', tilePath: 'https://assets.tarkov.dev/maps/factory/2nd/{z}/{x}/{y}.png', svgLayer: 'Second' }, { name: 'evil', tilePath: 'https://evil.example/{z}/{x}/{y}.png' }] }] },
  { normalizedName: 'the-lab', maps: [{ key: 'the-lab', minZoom: 0, maxZoom: 0, tileSize: 175, tilePath: 'https://assets.tarkov.dev/maps/labs_v4/1st/{z}/{x}/{y}.png' }] },
]

function fakeTarkovDev() {
  const calls: string[] = []
  const impl = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('maps.json')) return new Response(JSON.stringify(MAPS))
    if (url.endsWith('.svg')) return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    // Only the top-left tile of every zoom exists; the rest of the pyramid is empty.
    if (/\/\d+\/0\/0\.png$/.test(url)) return new Response(new Uint8Array(PNG))
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  return { impl, calls }
}

test('map mirror: plan from maps.json, only tarkov.dev paths, the whole pyramid per set', () => {
  const plan = mirrorPlan(MAPS)
  assert.deepEqual(plan.sets.map((set) => set.path), ['maps/factory/main', 'maps/factory/2nd', 'maps/labs_v4/1st'])
  assert.deepEqual(plan.svgs, ['maps/svg/Factory.svg'])
  assert.equal(setTileCount(plan.sets[0]), 1 + 4)
  assert.equal(setTileCount(plan.sets[2]), 4, 'smaller tiles: more per axis (175 px → 2 at zoom 0)')
  assert.equal(tileSetPath('https://assets.tarkov.dev/maps/../x/{z}/{x}/{y}.png'), 'maps/../x')
  assert.equal(tileSetPath('https://evil.example/maps/x/{z}/{x}/{y}.png'), undefined)
})

test('map mirror: start is idempotent and stop clears both schedules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'raidos-mirror-schedule-'))
  try {
    const storage = new MirrorStorage({ root: dir, minFreeBytes: 0, freeBytes: async () => 10_000 })
    const mirror = new MapMirror({ dir, storage, fetch: fakeTarkovDev().impl })
    const schedules = () => mirror as unknown as { initial: unknown; timer: unknown }
    mirror.start(60_000, 60_000)
    const first = { ...schedules() }
    mirror.start(1, 1)
    assert.equal(schedules().initial, first.initial)
    assert.equal(schedules().timer, first.timer)
    mirror.stop()
    assert.equal(schedules().initial, null)
    assert.equal(schedules().timer, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('map mirror: downloads existing tiles and schemes, skips empty ones, a complete set is not crawled again; served under /v1/map-tiles', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'raidos-mirror-'))
  try {
    const remote = fakeTarkovDev()
    const storage = new MirrorStorage({ root: dir, minFreeBytes: 0, freeBytes: async () => 10_000 })
    const mirror = new MapMirror({ dir, storage, fetch: remote.impl, concurrency: 2, minFreeBytes: 0 })
    await mirror.run()
    const status = mirror.status()
    assert.equal(status.state, 'done')
    assert.equal(status.completeSets, 3)
    assert.equal(status.tiles.saved, 2 + 2 + 1)
    assert.equal(status.svgs, 1)
    assert.ok(existsSync(join(dir, 'maps/factory/main/1/0/0.png')))
    assert.ok(!existsSync(join(dir, 'maps/factory/main/1/1/1.png')))
    assert.ok((await storage.read('maps', 'maps.json'))?.toString().includes('factory'))
    assert.ok(!remote.calls.some((url) => url.includes('evil.example')))

    const before = remote.calls.length
    await mirror.run()
    assert.equal(remote.calls.length - before, 2, 'second pass: only maps.json and the scheme are read again')

    const app = express().use(createMapTilesRouter(mirror))
    const server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.on('listening', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      const tile = await fetch(`${base}/v1/map-tiles/maps/factory/main/1/0/0.png`)
      assert.equal(tile.status, 200)
      assert.equal(tile.headers.get('content-type'), 'image/png')
      assert.ok(Buffer.from(await tile.arrayBuffer()).equals(PNG))
      assert.equal((await fetch(`${base}/v1/map-tiles/maps/factory/main/1/1/1.png`)).status, 404)
      // Our own render of Streets and Lighthouse has tiles left of and above tile 0.
      mkdirSync(join(dir, 'maps/factory/main/1/-1'), { recursive: true })
      writeFileSync(join(dir, 'maps/factory/main/1/-1/-2.png'), PNG)
      const negative = await fetch(`${base}/v1/map-tiles/maps/factory/main/1/-1/-2.png`)
      assert.equal(negative.status, 200)
      assert.ok(Buffer.from(await negative.arrayBuffer()).equals(PNG))
      assert.equal((await fetch(`${base}/v1/map-tiles/maps/factory/main/1/--1/0.png`)).status, 404)
      assert.equal((await fetch(`${base}/v1/map-tiles/maps/svg/Factory.svg`)).headers.get('content-type'), 'image/svg+xml')
      assert.equal((await fetch(`${base}/v1/map-tiles/maps.json`)).status, 200)
      // Our own sets laid over tarkov.dev's maps.json (raidos-tiles.json): complete sets only, a tarkov.dev path kept.
      writeFileSync(join(dir, OWN_TILES_FILE), JSON.stringify({
        factory: { layers: {
          Roof: 'https://assets.tarkov.dev/maps/labs_v4/1st/{z}/{x}/{y}.png',
          '2nd': 'https://assets.tarkov.dev/maps/labs_v4/1st/{z}/{x}/{y}.png',
          Gone: 'https://assets.tarkov.dev/maps/factory/none/{z}/{x}/{y}.png',
          Up: 'https://assets.tarkov.dev/maps/../labs_v4/1st/{z}/{x}/{y}.png',
          Evil: 'https://evil.example/{z}/{x}/{y}.png',
        } },
        'the-lab': { tilePath: 'https://assets.tarkov.dev/maps/factory/main/{z}/{x}/{y}.png' },
      }))
      type Served = Array<{ maps: Array<{ tilePath?: string; layers?: Array<{ name: string; tilePath?: string }> }> }>
      const served = await (await fetch(`${base}/v1/map-tiles/maps.json`)).json() as Served
      assert.deepEqual(served[0]!.maps[0]!.layers!.map((layer) => [layer.name, layer.tilePath]), [
        ['2nd', 'https://assets.tarkov.dev/maps/factory/2nd/{z}/{x}/{y}.png'],
        ['evil', 'https://evil.example/{z}/{x}/{y}.png'],
        ['Roof', 'https://assets.tarkov.dev/maps/labs_v4/1st/{z}/{x}/{y}.png'],
      ])
      assert.equal(served[1]!.maps[0]!.tilePath, 'https://assets.tarkov.dev/maps/labs_v4/1st/{z}/{x}/{y}.png')
      assert.equal((await fetch(`${base}/v1/map-tiles/maps/factory/main/.complete`)).status, 404)
      assert.equal((await fetch(`${base}/v1/map-tiles/..%2F..%2Fetc%2Fpasswd`)).status, 404)
      assert.equal(((await (await fetch(`${base}/v1/map-tiles/status`)).json()) as { completeSets: number }).completeSets, 3)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
