import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSprites, sprite } from './markerSprites'

/**
 * A player's report (19.11.2026, Shoreline, PvE, 0.6.0.323): «Документы боевого пропуска» on, counted 30, not one on the map;
 * «Драгоценности» the same; the bosses (page icons) were there. The canvas icons are drawn through a canvas filter (their
 * drop shadows), which some graphics drivers turn into an empty picture; and a picture that failed to load left its points
 * unseen for good.
 */
interface Call { op: string; filter?: string }

let calls: Call[]
let emptyThroughFilter: boolean

function fakeContext() {
  let filter = 'none'
  let drewThroughFilter = false
  let drewPlain = false
  const context = {
    get filter() { return filter },
    set filter(value: string) { filter = value },
    scale() {}, save() {}, restore() { filter = 'none' }, setTransform() {}, translate() {}, rotate() {},
    clearRect() { drewThroughFilter = false; drewPlain = false; calls.push({ op: 'clear' }) },
    drawImage() { calls.push({ op: 'image', filter }); if (filter !== 'none') drewThroughFilter = true; else drewPlain = true },
    arc() {}, beginPath() {}, closePath() {}, moveTo() {}, arcTo() {}, fill() { calls.push({ op: 'fill', filter }); drewPlain = true }, stroke() {}, fillRect() {},
    fillText() {}, measureText: () => ({ width: 10 }), setLineDash() {},
    getImageData: (_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4)
      if (drewPlain || (drewThroughFilter && !emptyThroughFilter)) data[3] = 255
      return { data }
    },
  }
  return context
}

beforeEach(() => {
  calls = []
  emptyThroughFilter = false
  resetSprites()
  const create = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const element = create(tag)
    if (tag === 'canvas') (element as HTMLCanvasElement).getContext = (() => fakeContext()) as unknown as HTMLCanvasElement['getContext']
    return element
  }) as typeof document.createElement)
})
afterEach(() => { vi.restoreAllMocks() })

/** A picture that loads (or fails) as soon as its source is set. */
function pictures(outcome: 'load' | 'error') {
  vi.stubGlobal('Image', class {
    decoding = ''
    naturalWidth = 32
    naturalHeight = 32
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) { queueMicrotask(() => (outcome === 'load' ? this.onload : this.onerror)?.()) }
  })
}

const spec = { src: '/document.webp', size: [30, 30] as const, anchor: [15, 15] as const, filter: 'drop-shadow(0 1px 2px black)' }

describe('the map points drawn on the canvas', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('are drawn again without the filter where the filter draws nothing, and so from then on', async () => {
    pictures('load')
    emptyThroughFilter = true
    expect(sprite(spec)).toBeNull()
    await Promise.resolve()
    expect(sprite(spec)).not.toBeNull()
    const images = calls.filter((call) => call.op === 'image')
    expect(images.map((call) => call.filter)).toEqual([spec.filter, 'none'])
    // the next kind of point: plain at once
    calls = []
    expect(sprite({ ...spec, src: '/valuable.webp' })).toBeNull()
    await Promise.resolve()
    sprite({ ...spec, src: '/valuable.webp' })
    expect(calls.filter((call) => call.op === 'image').map((call) => call.filter)).toEqual(['none'])
  })

  it('keep the filter where it draws', async () => {
    pictures('load')
    sprite(spec)
    await Promise.resolve()
    sprite(spec)
    expect(calls.filter((call) => call.op === 'image').map((call) => call.filter)).toEqual([spec.filter])
  })

  it('get a mark of their own when their picture does not load, and the map is told to draw again', async () => {
    pictures('error')
    const { onSpritesReady } = await import('./markerSprites')
    const redraw = vi.fn()
    const stop = onSpritesReady(redraw)
    expect(sprite(spec)).toBeNull()
    await Promise.resolve()
    expect(redraw).toHaveBeenCalled()
    expect(sprite(spec)).not.toBeNull()
    expect(calls.some((call) => call.op === 'fill')).toBe(true)
    stop()
  })
})
