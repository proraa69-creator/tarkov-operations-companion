import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' }, nativeImage: {}, screen: {} }))
vi.mock('./screenOcr.js', () => ({ recognizeRegion: vi.fn() }))
vi.mock('./experimental/win32.js', () => ({ captureScreenRegion: vi.fn(), foregroundDisplayMode: vi.fn(), visibleGameRect: vi.fn() }))

const { CORNER, cornerRect, HEADER_MIN_SHARE, HEADER_STRIP, headerShare, headerStripRect, listArea } = await import('./extractsReader')

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

// Owner, 19.11.2026: «опять нажимаю О… ничего не происходит» — a 3440×1440 screen with the game, a 1920×1080 one to its right.
describe('the screen the list is read from', () => {
  const game = { x: 0, y: 0, width: 3440, height: 1440 }
  const other = { x: 3440, y: 0, width: 1920, height: 1080 }

  it('is the window of the game, wherever the pointer is', () => {
    const area = listArea(game, other)
    expect(area).toEqual(game)
    // the corner of the list and the header strip on the screen of the game, at its right edge
    expect(cornerRect(area)).toEqual({ x: 3440 - 806, y: 0, width: 806, height: 1008 })
    const strip = headerStripRect(area)
    expect(strip.x).toBe(3440 - 720)
    expect(strip.x + strip.width).toBe(3440 - 288)
    expect(strip.y).toBe(32)
  })

  it('is the display of the pointer only when the window of the game is not found', () => {
    expect(listArea(null, other)).toEqual(other)
    expect(cornerRect(listArea(null, other)).x).toBe(3440 + 1920 - Math.round(1080 * CORNER.width))
  })

  it('is the own top-right corner of a game in a window', () => {
    expect(cornerRect({ x: 100, y: 50, width: 1600, height: 900 })).toEqual({ x: 100 + 1600 - 504, y: 50, width: 504, height: 630 })
  })
})

describe('report 227: the exit header strip is copied only in a raid', () => {
  it('no raid: never; keys seen: every 1.5 s; keys hidden: twice a second', async () => {
    const { headerPollMs, HEADER_POLL_KEYS_SEEN_MS } = await import('./extractsReader')
    expect(headerPollMs({ raid: false, keysSeen: false })).toBe(0)
    expect(headerPollMs({ raid: false, keysSeen: true })).toBe(0)
    expect(headerPollMs({ raid: true, keysSeen: true })).toBe(HEADER_POLL_KEYS_SEEN_MS)
    expect(headerPollMs({ raid: true, keysSeen: false })).toBe(500)
  })

  it('the watch copies the screen at the pace it is given, and nothing at 0', async () => {
    const win32 = await import('./experimental/win32.js')
    const electron = await import('electron') as unknown as { screen: Record<string, unknown> }
    Object.assign(electron.screen, { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }), dipToScreenRect: (_: unknown, rect: unknown) => rect })
    vi.mocked(win32.visibleGameRect).mockReturnValue({ x: 0, y: 0, width: 1920, height: 1080 })
    vi.mocked(win32.foregroundDisplayMode).mockReturnValue('fullscreen')
    vi.mocked(win32.captureScreenRegion).mockReturnValue(null)
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'win32' })
    vi.useFakeTimers()
    try {
      const { watchExtractsHeader } = await import('./extractsReader')
      let pace = 0
      const stop = watchExtractsHeader(() => true, () => {}, () => pace)
      vi.advanceTimersByTime(5000)
      expect(win32.captureScreenRegion).not.toHaveBeenCalled()
      pace = 1500
      vi.advanceTimersByTime(6000)
      expect(vi.mocked(win32.captureScreenRegion).mock.calls.length).toBe(4)
      vi.mocked(win32.captureScreenRegion).mockClear()
      pace = 500
      vi.advanceTimersByTime(5000)
      expect(vi.mocked(win32.captureScreenRegion).mock.calls.length).toBe(10)
      stop()
    } finally {
      vi.useRealTimers()
      Object.defineProperty(process, 'platform', platform)
    }
  })
})
