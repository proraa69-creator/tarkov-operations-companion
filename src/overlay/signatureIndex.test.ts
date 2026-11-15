import { describe, expect, it } from 'vitest'
import { pictureSignature, type Pixels } from './iconSignature'
import { rankByIndex } from './pictureIndex'
import { decodeSignatureIndex, encodeSignatureIndex, type IndexedItem } from './signatureIndex'

function picture(seed: number): Pixels {
  const width = 64, height = 64
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      data[index] = (x * seed * 7 + y * 3) % 256
      data[index + 1] = (y * seed * 5 + x) % 256
      data[index + 2] = ((x ^ y) * seed) % 256
      data[index + 3] = 255
    }
  }
  return { width, height, data, order: 'rgba', alpha: true }
}
const area = { x: 2, y: 2, width: 60, height: 60 }
const item = (id: string, seed: number, cols = 1, rows = 1): IndexedItem => ({ id, cols, rows, signature: pictureSignature(picture(seed), area) })

describe('the picture index file', () => {
  it('reads back exactly what was written', () => {
    const items = [item('0123456789abcdef01234567', 3), item('aaaaaaaaaaaaaaaaaaaaaaaa', 11, 2, 1)]
    const decoded = decodeSignatureIndex(encodeSignatureIndex(items, 1_700_000_000_000))!
    expect(decoded.items).toEqual(items)
    expect(decoded.builtAt).toBe(1_700_000_000_000)
  })

  it('leaves out what does not fit and refuses other files', () => {
    const decoded = decodeSignatureIndex(encodeSignatureIndex([item('not-an-id', 3), item('bbbbbbbbbbbbbbbbbbbbbbbb', 5)]))!
    expect(decoded.items.map((entry) => entry.id)).toEqual(['bbbbbbbbbbbbbbbbbbbbbbbb'])
    expect(decodeSignatureIndex(new Uint8Array(40))).toBeNull()
    expect(decodeSignatureIndex(encodeSignatureIndex([item('bbbbbbbbbbbbbbbbbbbbbbbb', 5)]).subarray(0, 60))).toBeNull()
  })
})

describe('ranking a screen picture against the index', () => {
  const index = { builtAt: 0, items: [item('a'.repeat(24), 3), item('b'.repeat(24), 11), item('c'.repeat(24), 17, 2, 1)] }
  const screen = (seed: number, cols = 1, rows = 1) => ({ grid: true, layouts: [{ cols, rows, turns: { 0: pictureSignature(picture(seed), area) } }] })

  it('answers the one picture that is close and clearly the closest, among items of the size only', () => {
    const verdict = rankByIndex(screen(3), index)
    expect(verdict).toMatchObject({ id: 'a'.repeat(24), reason: 'match', compared: 2 })
    expect(rankByIndex(screen(17, 2, 1), index).id).toBe('c'.repeat(24))
  })

  it('answers nothing for a look-alike pair, a far picture or no index', () => {
    const twins = { builtAt: 0, items: [item('a'.repeat(24), 3), item('d'.repeat(24), 3)] }
    expect(rankByIndex(screen(3), twins)).toMatchObject({ id: null, reason: 'no-margin' })
    expect(rankByIndex(screen(3), twins).nearby.map((hit) => hit.id).sort()).toEqual(['a'.repeat(24), 'd'.repeat(24)])
    expect(rankByIndex(screen(29), index).id).toBeNull()
    expect(rankByIndex(screen(3), null).reason).toBe('no-index')
    expect(rankByIndex(screen(3, 3, 3), index).reason).toBe('no-layout')
  })
})
