import { describe, expect, it } from 'vitest'
import { parseTrialFeatures, questTableScanUntil, setTrialFeatures } from './trialFeatures'

describe('trial features', () => {
  it('keeps the quest table reading on only until its end', () => {
    setTrialFeatures(parseTrialFeatures({ features: { questTableScan: '2026-11-01T20:00:00.000Z' } })!)
    expect(questTableScanUntil(Date.parse('2026-11-01T19:59:00Z'))).toBe('2026-11-01T20:00:00.000Z')
    expect(questTableScanUntil(Date.parse('2026-11-01T20:00:00Z'))).toBeNull()
    setTrialFeatures(parseTrialFeatures({ features: { questTableScan: null } })!)
    expect(questTableScanUntil(Date.parse('2026-10-31T00:00:00Z'))).toBeNull()
    expect(parseTrialFeatures(null)).toBeNull()
    expect(parseTrialFeatures({ features: { questTableScan: 'soon' } })).toEqual({ questTableScan: null })
  })
})
