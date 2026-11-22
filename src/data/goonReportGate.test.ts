import { beforeEach, describe, expect, it } from 'vitest'
import { goonReportBlock, lastRaidStart, noteRaidStart } from './goonReportGate'

const MIN = 60_000

describe('«Видел» spam protection (owner, 17.11.2026)', () => {
  beforeEach(() => localStorage.clear())

  it('once every 10 minutes, everywhere', () => {
    const now = Date.parse('2026-11-17T12:00:00.000Z')
    expect(goonReportBlock({ raidTracked: false, raidStart: 0, now })).toBeNull()
    expect(goonReportBlock({ lastOwnAt: now - 2 * MIN, raidTracked: false, raidStart: 0, now })).toEqual({ kind: 'wait', minutes: 8 })
    expect(goonReportBlock({ lastOwnAt: now - 9.5 * MIN, raidTracked: false, raidStart: 0, now })).toEqual({ kind: 'wait', minutes: 1 })
    expect(goonReportBlock({ lastOwnAt: now - 11 * MIN, raidTracked: false, raidStart: 0, now })).toBeNull()
  })

  it('on the PC, after a sighting the next one waits for a new raid; a raid it never saw holds it at most an hour', () => {
    const now = Date.parse('2026-11-17T12:00:00.000Z')
    const sighting = now - 20 * MIN
    expect(goonReportBlock({ lastOwnAt: sighting, raidTracked: true, raidStart: sighting - 5 * MIN, now })).toEqual({ kind: 'raid' })
    expect(goonReportBlock({ lastOwnAt: sighting, raidTracked: true, raidStart: sighting + 3 * MIN, now })).toBeNull()
    expect(goonReportBlock({ lastOwnAt: now - 61 * MIN, raidTracked: true, raidStart: 0, now })).toBeNull()
    // no logs (the phone, the site): the 10 minutes only
    expect(goonReportBlock({ lastOwnAt: sighting, raidTracked: false, raidStart: 0, now })).toBeNull()
  })

  it('remembers the newest raid start it saw', () => {
    noteRaidStart({ inRaid: true, since: 1000 })
    noteRaidStart({ inRaid: false })
    noteRaidStart({ inRaid: true, since: 500 })
    expect(lastRaidStart()).toBe(1000)
    noteRaidStart({ inRaid: true, since: 2000 })
    expect(lastRaidStart()).toBe(2000)
  })
})
