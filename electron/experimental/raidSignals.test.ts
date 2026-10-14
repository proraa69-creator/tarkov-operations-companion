import { describe, expect, it } from 'vitest'
import { RAID_SIGNAL_MS, raidSignalActive, type RaidSignals } from './raidSignals'

const none = (): RaidSignals => ({ minimapShown: false, at: {} })

describe('signs of a raid for the quest scanner', () => {
  it('holds the screen copies back while the minimap is shown, when no Logs folder tells the raids', () => {
    expect(raidSignalActive({ ...none(), minimapShown: true }, 1000)).toBe(true)
    // The logs tell: the minimap merely left open after the raid does not stop the reading of the menus.
    expect(raidSignalActive({ ...none(), minimapShown: true }, 1000, { logsWatched: true })).toBe(false)
    expect(raidSignalActive(none(), 1000)).toBe(false)
  })

  it('counts the minimap key and a screenshot with coordinates for a few minutes, movement for half a minute', () => {
    const at = 10_000
    expect(raidSignalActive({ ...none(), at: { minimap: at } }, at + RAID_SIGNAL_MS.minimap - 1)).toBe(true)
    expect(raidSignalActive({ ...none(), at: { minimap: at } }, at + RAID_SIGNAL_MS.minimap)).toBe(false)
    expect(raidSignalActive({ ...none(), at: { screenshot: at } }, at + 60_000, { logsWatched: true })).toBe(true)
    expect(raidSignalActive({ ...none(), at: { movement: at } }, at + 29_000)).toBe(true)
    expect(raidSignalActive({ ...none(), at: { movement: at } }, at + 31_000)).toBe(false)
    expect(RAID_SIGNAL_MS.movement).toBeLessThan(RAID_SIGNAL_MS.minimap)
  })

  it('ignores a sign from the future (a screenshot with a later file time)', () => {
    expect(raidSignalActive({ ...none(), at: { screenshot: 50_000 } }, 40_000)).toBe(false)
  })
})
