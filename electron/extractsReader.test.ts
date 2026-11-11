import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ nativeImage: {}, screen: {} }))
vi.mock('./screenOcr.js', () => ({ recognizeRegion: vi.fn() }))
vi.mock('./experimental/win32.js', () => ({ captureScreenRegion: vi.fn(), foregroundDisplayMode: vi.fn() }))

const { CORNER, HEADER_MIN_SHARE, HEADER_STRIP, headerShare } = await import('./extractsReader')

/** BGRA pixels: `lime` of them the list header's green (#7cb518 under the game's light), the rest `other`. */
function strip(count: number, lime: number, other: [number, number, number]) {
  const data = new Uint8Array(count * 4)
  for (let index = 0; index < count; index += 1) {
    const [r, g, b] = index < lime ? [124, 181, 24] : other
    data.set([b, g, r, 255], index * 4)
  }
  return data
}

describe('the exit list seen on screen with no key (owner, 11.11.2026)', () => {
  it('finds the green header where the owner\'s screenshots have it, and not in green leaves or the sky', () => {
    // the header covers some 60 % of the strip on the owner's screenshots (its icon and words the rest)
    expect(headerShare(strip(100, 61, [10, 10, 10]), 100, 1)).toBeGreaterThanOrEqual(HEADER_MIN_SHARE)
    expect(headerShare(strip(100, 0, [70, 120, 40]), 100, 1)).toBe(0) // dark green leaves
    expect(headerShare(strip(100, 0, [180, 210, 235]), 100, 1)).toBe(0) // sky
    expect(headerShare(strip(100, 20, [10, 10, 10]), 100, 1)).toBeLessThan(HEADER_MIN_SHARE)
  })

  it('reads a corner as wide as the list (0.53 of the height on 3440×1440) and tall enough for twelve lines', () => {
    expect(CORNER.width).toBeGreaterThanOrEqual(0.54)
    expect(CORNER.width).toBeLessThan(0.6)
    expect(CORNER.height).toBeGreaterThanOrEqual(0.65)
    expect(HEADER_STRIP.from).toBeLessThan(CORNER.width)
  })
})
