import { describe, expect, it } from 'vitest'
import { parseGoonReport } from './goonTracker'
describe('Goons feed formats', () => {
  it('reads the live single-report shape and millisecond timestamp', () => {
    expect(parseGoonReport({ map: '5704e4dad2720bb55b8b4567', timestamp: '1790540705000' })).toEqual({ mapId: 'lighthouse', reportedAt: new Date(1790540705000).toISOString(), source: 'community' })
  })
  it('supports older arrays and chooses the newest valid report', () => {
    expect(parseGoonReport([{ map: { normalizedName: 'woods' }, timestamp: 1790540705 }, { map: 'customs', timestamp: 1790540805 }])?.mapId).toBe('customs')
  })
  it('rejects unknown maps, missing or invalid timestamps', () => {
    expect(parseGoonReport({ map: 'factory', timestamp: Date.now() })).toBeNull()
    expect(parseGoonReport({ map: 'woods' })).toBeNull()
    expect(parseGoonReport(null)).toBeNull()
  })
})
