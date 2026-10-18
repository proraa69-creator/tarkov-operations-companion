import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createItemImageResponder, itemImageFile, itemImageRedirect } from './itemImages'

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
    const answer = createItemImageResponder(folder, fetchImpl)
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
})
