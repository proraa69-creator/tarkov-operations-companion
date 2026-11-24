import { describe, expect, it } from 'vitest'
import { parseSavedWindow, restoredBounds } from './windowState'

const LEFT = { x: 0, y: 0, width: 1920, height: 1040 }
const RIGHT = { x: 1920, y: 0, width: 2560, height: 1400 }
const MINIMUM = { width: 1050, height: 700 }

describe('the main window comes back where it was left', () => {
  it('on the second monitor, with its place and size', () => {
    const saved = { x: 2100, y: 60, width: 1600, height: 1000 }
    expect(restoredBounds(saved, [LEFT, RIGHT], MINIMUM)).toEqual(saved)
  })

  it('a monitor that is gone gives the usual start, not a window out of sight', () => {
    expect(restoredBounds({ x: 2100, y: 60, width: 1600, height: 1000 }, [LEFT], MINIMUM)).toBeNull()
  })

  it('across two monitors it stays on the one holding the most of it', () => {
    const bounds = restoredBounds({ x: 1000, y: 100, width: 1500, height: 900 }, [LEFT, RIGHT], MINIMUM)
    expect(bounds).toEqual({ x: 420, y: 100, width: 1500, height: 900 })
  })

  it('bigger than a smaller monitor now: fitted into it', () => {
    const bounds = restoredBounds({ x: 10, y: 10, width: 2500, height: 1300 }, [LEFT], MINIMUM)
    expect(bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1040 })
  })

  it('a monitor to the left has negative coordinates, and they count', () => {
    const leftOfMain = { x: -1920, y: 0, width: 1920, height: 1040 }
    const saved = { x: -1800, y: 40, width: 1500, height: 900 }
    expect(restoredBounds(saved, [LEFT, leftOfMain], MINIMUM)).toEqual(saved)
  })

  it('never smaller than the window may be', () => {
    expect(restoredBounds({ x: 10, y: 10, width: 300, height: 200 }, [LEFT], MINIMUM)).toEqual({ x: 10, y: 10, width: 1050, height: 700 })
  })

  it('a damaged file counts as none', () => {
    expect(parseSavedWindow(null)).toBeNull()
    expect(parseSavedWindow({ x: 1, y: 2, width: 'a', height: 4 })).toBeNull()
    expect(parseSavedWindow({ x: 1, y: 2, width: 0, height: 4 })).toBeNull()
    expect(parseSavedWindow({ x: 1, y: 2, width: 3, height: 4, maximized: true })).toEqual({ x: 1, y: 2, width: 3, height: 4, maximized: true })
    expect(parseSavedWindow({ x: 1, y: 2, width: 3, height: 4, maximized: 'yes' })).toEqual({ x: 1, y: 2, width: 3, height: 4, maximized: false })
  })
})
