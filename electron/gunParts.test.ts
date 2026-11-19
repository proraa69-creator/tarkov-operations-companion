import { describe, expect, it } from 'vitest'
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

  it('reads the file from its folder, 404 when it is not there', async () => {
    const read = async (path: string) => {
      if (path.replace(/\\/g, '/').endsWith('/parts-folder/index.json')) return new TextEncoder().encode('{"ppm":1000,"parts":{}}')
      throw new Error('missing')
    }
    const answer = createGunPartResponder('/parts-folder', read)
    const found = await answer('raidos-img://parts/index.json')
    expect(found.status).toBe(200)
    expect(found.headers.get('content-type')).toBe('application/json')
    expect(found.headers.get('access-control-allow-origin')).toBe('*')
    expect(await found.json()).toEqual({ ppm: 1000, parts: {} })
    expect((await answer('raidos-img://parts/5447a9cd4bdc2dbd208b4567.webp')).status).toBe(404)
    expect((await answer('raidos-img://parts/evil.exe')).status).toBe(404)
  })
})
