import { describe, expect, it } from 'vitest'
import { BOTTOM, bottomToCut, isScreenshotShape } from './crop-guide-photos.mjs'

describe('crop-guide-photos', () => {
  it('takes the game\'s own frames, 16:9 and 16:10, and nothing else', () => {
    expect(isScreenshotShape(1280, 720)).toBe(true)
    expect(isScreenshotShape(2560, 1440)).toBe(true)
    expect(isScreenshotShape(1280, 800)).toBe(true)
    // An editor's cut of a frame, a character card, a tall picture: these lines went with the edge.
    expect(isScreenshotShape(1280, 698)).toBe(false)
    expect(isScreenshotShape(367, 499)).toBe(false)
    expect(isScreenshotShape(766, 1061)).toBe(false)
  })

  it('cuts the bottom strip of a screenshot and leaves other shapes alone', () => {
    expect(bottomToCut('a', 1280, 720, {})).toBe(BOTTOM)
    expect(bottomToCut('a', 1280, 1061, {})).toBe(0)
    // What goes lies below every version and path line read on the listed photos (from about 95.5% of the height).
    expect(1 - BOTTOM).toBeLessThan(0.955)
  })

  it('an exception wins over the shape: another share, or none', () => {
    expect(bottomToCut('high', 1280, 720, { high: { bottom: 0.08 } })).toBe(0.08)
    expect(bottomToCut('clean', 1280, 720, { clean: {} })).toBe(0)
    expect(bottomToCut('card', 367, 499, { card: { bottom: 0.1 } })).toBe(0.1)
  })
})
