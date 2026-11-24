import { describe, expect, it } from 'vitest'
import { writePartPack } from '../src/arsenal/partPack'
import { createGunPartResponder, gunPartFile } from './gunParts'

describe('gun part pictures', () => {
  it('answers only part files and the index of the parts folder', () => {
    expect(gunPartFile('raidos-img://parts/5447a9cd4bdc2dbd208b4567.webp')).toBe('5447a9cd4bdc2dbd208b4567.webp')
    expect(gunPartFile('raidos-img://parts/5447a9cd4bdc2dbd208b4567.d.png')).toBe('5447a9cd4bdc2dbd208b4567.d.png')
    expect(gunPartFile('raidos-img://parts/index.json')).toBe('index.json')
    expect(gunPartFile('raidos-img://parts/../main.js')).toBeNull()
    expect(gunPartFile('raidos-img://parts/index.json?x=1')).toBeNull()
    expect(gunPartFile('raidos-img://item/index.json')).toBeNull()
    expect(gunPartFile('https://raidos.app/parts/index.json')).toBeNull()
  })

  it('opens the file from the encrypted pack, 404 when the pack does not hold it (owner, 22.11.2026)', async () => {
    const pack = await writePartPack([['index.json', new TextEncoder().encode('{"ppm":1000,"parts":{}}')]])
    let reads = 0
    const read = async (path: string) => {
      reads += 1
      if (path.replace(/\\/g, '/').endsWith('/dist/gun-parts.pack')) return pack
      throw new Error('missing')
    }
    const answer = createGunPartResponder('/dist/gun-parts.pack', read)
    const found = await answer('raidos-img://parts/index.json')
    expect(found.status).toBe(200)
    expect(found.headers.get('content-type')).toBe('application/json')
    expect(found.headers.get('access-control-allow-origin')).toBe('*')
    expect(await found.json()).toEqual({ ppm: 1000, parts: {} })
    expect((await answer('raidos-img://parts/5447a9cd4bdc2dbd208b4567.webp')).status).toBe(404)
    expect((await answer('raidos-img://parts/evil.exe')).status).toBe(404)
    // the pack is read once
    expect(reads).toBe(1)
    // no pack: nothing, and no crash
    expect((await createGunPartResponder('/nowhere.pack', read)('raidos-img://parts/index.json')).status).toBe(404)
  })
})
