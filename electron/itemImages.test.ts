import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createItemImageResponder, itemImageFile, itemImageRedirect, tarkovDevImageUrl } from './itemImages'

const FILE = '5d40419286f774318526545f-grid.webp'
const folders: string[] = []
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true, maxRetries: 3 }))) })

describe('item pictures through the main process', () => {
  it('redirects only the server item pictures', () => {
    expect(itemImageRedirect(`https://raidos.app/v1/item-images/${FILE}`)).toBe(`raidos-img://item/${FILE}`)
    expect(itemImageRedirect('https://raidos.app/v1/item-images/../manifest.json')).toBeNull()
    expect(itemImageRedirect(`https://raidos.app/v1/item-images/${FILE}?x=1`)).toBeNull()
    expect(itemImageRedirect('https://raidos.app/maps/tile.png')).toBeNull()
    expect(itemImageFile(`raidos-img://item/${FILE}`)).toBe(FILE)
    expect(itemImageFile(`raidos-img://other/${FILE}`)).toBeNull()
    expect(itemImageFile('raidos-img://item/secret.txt')).toBeNull()
  })

  it('downloads once, keeps the file and answers 404 for a missing picture', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'raidos-img-'))
    folders.push(folder)
    const fetchImpl = vi.fn(async (url: string) => url.endsWith(FILE) ? new Response(new Uint8Array([1, 2, 3])) : new Response(null, { status: 404 }))
    const answer = createItemImageResponder(folder, [{ name: 'server', url: (file) => `https://raidos.app/v1/item-images/${file}`, fetch: fetchImpl }])
    const [first, second] = await Promise.all([answer(`raidos-img://item/${FILE}`), answer(`raidos-img://item/${FILE}`)])
    expect(first.status).toBe(200)
    expect(first.headers.get('content-type')).toBe('image/webp')
    expect([...new Uint8Array(await second.arrayBuffer())]).toEqual([1, 2, 3])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.waitFor(async () => expect([...await readFile(join(folder, FILE))]).toEqual([1, 2, 3]))
    expect((await answer(`raidos-img://item/${FILE}`)).status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const lost = 'aaaaaaaaaaaaaaaaaaaaaaaa-icon.webp'
    expect((await answer(`raidos-img://item/${lost}`)).status).toBe(404)
    expect((await answer(`raidos-img://item/${lost}`)).status).toBe(404)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('falls through to the next source and reports why all failed', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'raidos-img-'))
    folders.push(folder)
    const down = vi.fn(async () => { throw new TypeError('fetch failed') })
    const tarkov = vi.fn(async (url: string) => new Response(url.endsWith('-grid-image.webp') ? new Uint8Array([7]) : null, { status: url.endsWith('-grid-image.webp') ? 200 : 404 }))
    const answer = createItemImageResponder(folder, [
      { name: 'server', url: (file) => `https://raidos.app/v1/item-images/${file}`, fetch: down },
      { name: 'tarkov.dev', url: tarkovDevImageUrl, fetch: tarkov },
    ])
    expect([...new Uint8Array(await (await answer(`raidos-img://item/${FILE}`)).arrayBuffer())]).toEqual([7])
    expect(tarkov).toHaveBeenCalledWith('https://assets.tarkov.dev/5d40419286f774318526545f-grid-image.webp', expect.anything())
    expect((await answer('raidos-img://item/5d40419286f774318526545f-base.webp')).status).toBe(404)
    await vi.waitFor(async () => expect(JSON.parse(await readFile(join(folder, 'last-failure.json'), 'utf8')).failures).toEqual({ server: 'TypeError: fetch failed', 'tarkov.dev': 'HTTP 404' }))
  })
})

describe('map files through the main process', () => {
  it('redirects only map files and serves them from memory, falling back to tarkov.dev', async () => {
    const { createMapFileResponder, mapFileRedirect, tarkovDevMapUrl } = await import('./itemImages')
    expect(mapFileRedirect('https://raidos.app/v1/map-tiles/maps/factory/main/1/0/0.png')).toBe('raidos-img://map/maps/factory/main/1/0/0.png')
    expect(mapFileRedirect('https://raidos.app/v1/map-tiles/maps/svg/Factory.svg')).toBe('raidos-img://map/maps/svg/Factory.svg')
    expect(mapFileRedirect('https://raidos.app/v1/map-tiles/status')).toBeNull()
    expect(mapFileRedirect('https://raidos.app/v1/map-tiles/maps/../x.png')).toBeNull()
    const down = vi.fn(async () => new Response(null, { status: 502 }))
    const upstream = vi.fn(async () => new Response('<svg/>'))
    const answer = createMapFileResponder([
      { name: 'raidos.app', url: (path) => `https://raidos.app/v1/map-tiles/${path}`, fetch: down },
      { name: 'tarkov.dev', url: tarkovDevMapUrl, fetch: upstream },
    ])
    const first = await answer('raidos-img://map/maps/svg/Factory.svg')
    expect(first.headers.get('content-type')).toBe('image/svg+xml')
    expect(first.headers.get('access-control-allow-origin')).toBe('*')
    expect(await first.text()).toBe('<svg/>')
    expect(upstream).toHaveBeenCalledWith('https://assets.tarkov.dev/maps/svg/Factory.svg', expect.anything())
    await answer('raidos-img://map/maps/svg/Factory.svg')
    expect(upstream).toHaveBeenCalledTimes(1)
  })
})

describe('asking the sources', () => {
  it('starts the next source when one hangs, and asks the one that answered first next time', async () => {
    const { createSourceRace, HEDGE_MS } = await import('./itemImages')
    const hanging = vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const working = vi.fn(async () => new Response(new Uint8Array([5])))
    const race = createSourceRace([
      { name: 'node', url: (key) => `https://raidos.app/${key}`, fetch: hanging },
      { name: 'chromium', url: (key) => `https://raidos.app/${key}`, fetch: working },
    ], 1024)
    const started = Date.now()
    const first = await race('a.png')
    expect('bytes' in first && [...first.bytes]).toEqual([5])
    expect(Date.now() - started).toBeGreaterThanOrEqual(HEDGE_MS - 50)
    expect(Date.now() - started).toBeLessThan(HEDGE_MS + 1500)
    // The hanging request was cancelled once the file came.
    expect(hanging.mock.calls[0][1].signal.aborted).toBe(true)
    const again = Date.now()
    await race('b.png')
    expect(Date.now() - again).toBeLessThan(HEDGE_MS)
    expect(hanging).toHaveBeenCalledTimes(1)
  })

  it('goes straight to the next source when one fails, and reports every failure', async () => {
    const { createSourceRace } = await import('./itemImages')
    const race = createSourceRace([
      { name: 'a', url: (key) => `https://a/${key}`, fetch: async () => { throw new TypeError('fetch failed') } },
      { name: 'b', url: (key) => `https://b/${key}`, fetch: async () => new Response(null, { status: 404 }) },
      { name: 'none', url: () => null, fetch: async () => new Response('x') },
    ], 1024)
    expect(await race('x.png')).toEqual({ failures: { a: 'TypeError: fetch failed', b: 'HTTP 404' } })
  })
})
