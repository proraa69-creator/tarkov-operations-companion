import { describe, expect, it } from 'vitest'
import { autoProfile } from './autoTune'

const picture = (luma: (index: number) => number, size = 4096) => {
  const pixels = new Uint8ClampedArray(size * 4)
  for (let index = 0; index < size; index += 1) pixels.set([luma(index), luma(index), luma(index), 255], index * 4)
  return pixels
}

describe('«Подобрать по кадру»', () => {
  it('a dark night picture: the middle and the shadows rise a lot', () => {
    const night = autoProfile(picture((index) => index % 10 === 0 ? 120 : 12))
    expect(night.gamma).toBeGreaterThan(1.5)
    expect(night.shadows).toBeGreaterThan(0.2)
  })

  it('a bright day picture: next to nothing changes', () => {
    const day = autoProfile(picture((index) => 110 + (index % 100)))
    expect(day.gamma).toBe(1)
    expect(day.shadows).toBe(0)
  })

  it('bright spots in the dark hold the brightest tones back more', () => {
    const lamps = autoProfile(picture((index) => index % 5 === 0 ? 250 : 15))
    const plain = autoProfile(picture(() => 15))
    expect(lamps.highlights).toBeLessThan(plain.highlights)
  })
})
