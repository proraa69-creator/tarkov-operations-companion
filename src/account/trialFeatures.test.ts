import { describe, expect, it } from 'vitest'
import { onQuestTableScanChange, parseTrialFeatures, playerQuestScanUntil, questTableScanUntil, setTrialFeatures, startPlayerQuestScan, stopPlayerQuestScan } from './trialFeatures'

describe('trial features', () => {
  it('keeps the quest table reading on only until its end', () => {
    setTrialFeatures(parseTrialFeatures({ features: { questTableScan: '2026-11-01T20:00:00.000Z' } })!)
    expect(questTableScanUntil(Date.parse('2026-11-01T19:59:00Z'))).toBe('2026-11-01T20:00:00.000Z')
    expect(questTableScanUntil(Date.parse('2026-11-01T20:00:00Z'))).toBeNull()
    setTrialFeatures(parseTrialFeatures({ features: { questTableScan: null } })!)
    expect(questTableScanUntil(Date.parse('2026-10-31T00:00:00Z'))).toBeNull()
    expect(parseTrialFeatures(null)).toBeNull()
    expect(parseTrialFeatures({ features: { questTableScan: 'soon' } })).toEqual({ questTableScan: null, mapFloorWheel: null })
  })
})

describe('«Найти квесты по экрану» (owner, 01.11.2026)', () => {
  it('the player turns the Tasks-table reading on for half an hour in any mode, «Готово» ends it; the later end of his and the owner\'s counts', () => {
    const now = Date.parse('2026-11-01T18:00:00Z')
    let changes = 0
    const unwatch = onQuestTableScanChange(() => { changes += 1 })
    startPlayerQuestScan(now)
    expect(playerQuestScanUntil(now)).toBe('2026-11-01T18:30:00.000Z')
    expect(questTableScanUntil(now)).toBe('2026-11-01T18:30:00.000Z')
    expect(questTableScanUntil(Date.parse('2026-11-01T18:30:00Z'))).toBeNull()
    setTrialFeatures({ questTableScan: '2026-11-02T18:00:00.000Z' })
    expect(questTableScanUntil(now)).toBe('2026-11-02T18:00:00.000Z')
    setTrialFeatures({ questTableScan: null })
    stopPlayerQuestScan()
    expect(questTableScanUntil(now)).toBeNull()
    expect(changes).toBe(4)
    unwatch()
  })
})
