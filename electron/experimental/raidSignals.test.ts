import { describe, expect, it } from 'vitest'
import { RAID_SIGNAL_MS, raidSignalActive, type RaidSignals } from './raidSignals'

const none = (): RaidSignals => ({ at: {} })

describe('signs of a raid for the quest scanner', () => {
  it('counts a screenshot with coordinates for a few minutes, movement for half a minute', () => {
    const at = 10_000
    expect(raidSignalActive(none(), 1000)).toBe(false)
    expect(raidSignalActive({ at: { screenshot: at } }, at + RAID_SIGNAL_MS.screenshot - 1)).toBe(true)
    expect(raidSignalActive({ at: { screenshot: at } }, at + RAID_SIGNAL_MS.screenshot)).toBe(false)
    expect(raidSignalActive({ at: { screenshot: at } }, at + 60_000)).toBe(true)
    expect(raidSignalActive({ at: { movement: at } }, at + 29_000)).toBe(true)
    expect(raidSignalActive({ at: { movement: at } }, at + 31_000)).toBe(false)
    expect(RAID_SIGNAL_MS.movement).toBeLessThan(RAID_SIGNAL_MS.screenshot)
  })

  it('no longer knows a minimap sign: no window is drawn over the game (owner, 15.10.2026)', () => {
    expect(Object.keys(RAID_SIGNAL_MS)).toEqual(['screenshot', 'movement'])
  })

  it('ignores a sign from the future (a screenshot with a later file time)', () => {
    expect(raidSignalActive({ at: { screenshot: 50_000 } }, 40_000)).toBe(false)
  })
})
