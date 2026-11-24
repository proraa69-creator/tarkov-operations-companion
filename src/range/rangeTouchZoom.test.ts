import { describe, expect, it } from 'vitest'
import { distanceAt, distanceShare, fixedZooms, zoomSlider } from './rangeTouchZoom'
import type { ScopeMode } from './rangeScope'

const mode = (zoom: number, extra: Partial<ScopeMode> = {}): ScopeMode => ({ zoom, fovDeg: 20 / zoom, ...extra } as ScopeMode)

describe('the phone scope sliders', () => {
  it('sets the distance in the toolbar slider steps, 5 to 1000 m', () => {
    expect(distanceAt(0)).toBe(5)
    expect(distanceAt(1)).toBe(1000)
    expect(distanceAt(distanceShare(300))).toBe(300)
    expect(distanceAt(0.5) % 5).toBe(0)
    expect(distanceAt(-3)).toBe(5)
    expect(distanceAt(Number.NaN)).toBe(5)
  })

  it('turns a variable mode smoothly over its range', () => {
    const slider = zoomSlider([mode(1, { zoomMax: 6 })], 0, 3.5)
    expect(slider?.share).toBeCloseTo(0.5)
    expect(slider?.stops).toBeUndefined()
    expect(slider?.at(0)).toEqual({ zoom: 1 })
    expect(slider?.at(1)).toEqual({ zoom: 6 })
    expect(slider?.at(0.3)).toEqual({ zoom: 2.5 })
  })

  it('steps a scope of fixed magnifications to the first mode of each', () => {
    // a red dot with a magnifier: ×1 (two reticles) and ×3
    const modes = [mode(1, { collimator: true }), mode(1, { collimator: true }), mode(3)]
    expect(fixedZooms(modes)).toEqual([{ zoom: 1, index: 0 }, { zoom: 3, index: 2 }])
    const slider = zoomSlider(modes, 1, 1)
    expect(slider?.share).toBe(0)
    expect(slider?.stops).toBe(2)
    expect(slider?.at(0.9)).toEqual({ mode: 2 })
    expect(slider?.at(0.2)).toEqual({ mode: 0 })
    expect(zoomSlider(modes, 2, 3)?.share).toBe(1)
  })

  it('has no slider where the sight has one magnification', () => {
    expect(zoomSlider([mode(4)], 0, 4)).toBeUndefined()
    expect(zoomSlider([mode(1), mode(1)], 1, 1)).toBeUndefined()
    expect(zoomSlider([], 0, 1)).toBeUndefined()
  })
})
