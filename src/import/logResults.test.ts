import { beforeEach, describe, expect, it } from 'vitest'
import { buildScanResult, identityScanResult } from './eftLogTimeline'
import { firstApplication, forgetAppliedLogResults } from './logResults'

const scan = (taskId: string) => buildScanResult([
  { kind: 'mode', at: 1, mode: 'pvp' },
  { kind: 'profile', at: 2, profileId: '61c4752c091f387bc2448d1c', accountId: 7 },
  { kind: 'quest', at: 3, taskId, status: 'active' },
], 1)

describe('a log scan is applied once (P20)', () => {
  beforeEach(() => forgetAppliedLogResults())

  it('not again when the page opens again (the language changed) or the main process sends the same scan', () => {
    const result = scan('5ae448bf86f7744d733e55ee')
    expect(firstApplication(result, 'profile-1')).toBe(true)
    expect(firstApplication({ ...result }, 'profile-1')).toBe(false)
    // The same logs read again give the same signature.
    expect(firstApplication(scan('5ae448bf86f7744d733e55ee'), 'profile-1')).toBe(false)
  })

  it('the identity, then the full read, then any change; and once more for another local profile', () => {
    const full = scan('5ae448bf86f7744d733e55ee')
    expect(firstApplication(identityScanResult(full), 'profile-1')).toBe(true)
    expect(firstApplication(full, 'profile-1')).toBe(true)
    expect(firstApplication(scan('596a0e1686f7741ddf17dbee'), 'profile-1')).toBe(true)
    expect(firstApplication(full, 'profile-2')).toBe(true)
  })

  it('works out the signature of a scan that came without one', () => {
    const bare = { ...scan('5ae448bf86f7744d733e55ee'), signature: undefined }
    expect(firstApplication(bare, 'profile-1')).toBe(true)
    expect(firstApplication(scan('5ae448bf86f7744d733e55ee'), 'profile-1')).toBe(false)
  })
})
