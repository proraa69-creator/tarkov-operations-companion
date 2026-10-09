import { describe, expect, it } from 'vitest'
import { reuseQuestReading, STORY_SCAN_TIMING as timing } from './storyScanTiming'

describe('fast but fresh story scans', () => {
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
})
