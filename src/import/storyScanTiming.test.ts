import { describe, expect, it } from 'vitest'
import { FRESH_GAME_MS, gameScanDelay, quietScanDelay, reuseQuestReading, reuseStableReading, STORY_SCAN_TIMING as timing, unchangedFrame } from './storyScanTiming'

describe('fast but fresh story scans', () => {
  it('looks at a game that shows no known screen less and less often, at most every four seconds', () => {
    expect(quietScanDelay(0)).toBe(timing.menuMs)
    expect(quietScanDelay(1)).toBe(timing.menuMs)
    expect(quietScanDelay(2)).toBeGreaterThan(timing.menuMs)
    expect(quietScanDelay(3)).toBeGreaterThan(quietScanDelay(2))
    expect(quietScanDelay(50)).toBe(timing.quietMaxMs)
    // A raid the logs miss: about one screen copy every 4 s after the first few looks.
    expect(timing.quietMaxMs).toBeLessThanOrEqual(4000)
  })
  it('budgets two independent OCR passes under ten seconds at three seconds per pass', () => {
    expect(timing.idleMs + 3000 + timing.storyMs + 3000).toBeLessThan(10_000)
  })
  it('does not reuse a low resolution menu result for the detailed confirmation', () => {
    expect(reuseQuestReading({ at: 1000, detail: false }, 1500, true, true)).toBe(false)
  })
  it('expires unchanged detail readings promptly instead of waiting six seconds', () => {
    expect(reuseQuestReading({ at: 1000, detail: true }, 1500, true, true)).toBe(true)
    expect(reuseQuestReading({ at: 1000, detail: true }, 2000, true, true)).toBe(false)
  })
  it('never reuses a changed image, an empty cache or a future timestamp', () => {
    expect(reuseQuestReading(null, 1500, true, true)).toBe(false)
    expect(reuseQuestReading({ at: 1000, detail: true }, 1500, true, false)).toBe(false)
    expect(reuseQuestReading({ at: 2000, detail: true }, 1500, true, true)).toBe(false)
  })
  it('reads an unchanged screen no more once two readings agreed, and again now and then', () => {
    const read = (reads: number) => ({ at: 1000, detail: true, reads })
    // The confirming second reading always happens.
    expect(reuseStableReading(read(1), 5000, true, true)).toBe(false)
    expect(reuseStableReading(read(2), 5000, true, true)).toBe(true)
    expect(reuseStableReading(read(2), 1000 + timing.stableReuseMs, true, true)).toBe(false)
    expect(reuseStableReading(read(2), 5000, true, false)).toBe(false)
    expect(reuseStableReading(read(2), 5000, false, true)).toBe(false)
    expect(reuseStableReading(null, 5000, true, true)).toBe(false)
  })
  it('tells a changed counter from the same screen', () => {
    const frame = new Uint8Array(120 * 68 * 4).fill(40)
    const same = frame.slice()
    same[400] = 44
    expect(unchangedFrame(frame, same)).toBe(true)
    const counter = frame.slice()
    counter[4 * 900 + 1] = 52
    expect(unchangedFrame(frame, counter)).toBe(false)
    expect(unchangedFrame(null, frame)).toBe(false)
    expect(unchangedFrame(frame, new Uint8Array(8))).toBe(false)
  })
})

describe('the first minutes of a game start', () => {
  it('are looked at at the quick pace, so «Выбор профиля и режима» is read before the player picks a mode', () => {
    expect(gameScanDelay(false, 9, true)).toBe(timing.menuMs)
    expect(gameScanDelay(false, 9, false)).toBe(timing.quietMaxMs)
    expect(gameScanDelay(true, 0, false)).toBe(timing.menuMs)
    expect(FRESH_GAME_MS).toBeGreaterThanOrEqual(60_000)
  })
})
