import { describe, expect, it } from 'vitest'
import { markCanvasPick, wasCanvasPick } from './canvasPick'

describe('a canvas point picked on the phone stays picked', () => {
  it('the map click of the same tap does not clear it, even when it is another event; a later tap does', () => {
    const pick = { originalEvent: new Event('pointerdown') }
    markCanvasPick(pick, 1000)
    expect(wasCanvasPick(pick, 5000)).toBe(true)
    expect(wasCanvasPick({ originalEvent: new Event('click') }, 1200)).toBe(true)
    expect(wasCanvasPick({ originalEvent: new Event('click') }, 2000)).toBe(false)
  })
})
