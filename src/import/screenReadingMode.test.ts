import { afterEach, describe, expect, it } from 'vitest'
import { buildScanResult } from './eftLogTimeline'
import { logsGameMode, screenReadingMode } from './screenReadingMode'

const scanIn = (mode: 'pvp' | 'pve' | 'seasonal') => buildScanResult([{ kind: 'mode', at: Date.parse('2026-10-14T08:00:00Z'), mode }], 1)

afterEach(() => sessionStorage.clear())

describe('the mode screen readings go to (audit P12)', () => {
  it('is the game\'s mode from its logs, whatever the app shows', () => {
    expect(screenReadingMode({ scan: scanIn('pve') }, 'pvp')).toBe('pve')
    expect(screenReadingMode({ scan: scanIn('seasonal'), notFound: false }, 'pve')).toBe('seasonal')
  })

  it('is the one kept for this session when no scan is at hand yet', () => {
    sessionStorage.setItem('eft-last-detected-mode', 'seasonal')
    expect(logsGameMode({})).toBe('seasonal')
    expect(screenReadingMode({}, 'pvp')).toBe('seasonal')
    sessionStorage.setItem('eft-last-detected-mode', 'arena')
    expect(logsGameMode({})).toBeUndefined()
  })

  it('is none while a Logs folder may exist but has not named the mode: the readings are held', () => {
    expect(screenReadingMode({}, 'pvp')).toBeNull()
    expect(screenReadingMode({ notFound: false }, 'pvp')).toBeNull()
  })

  it('is the app\'s mode only when no Logs folder was found at all', () => {
    expect(screenReadingMode({ notFound: true }, 'seasonal')).toBe('seasonal')
  })
})
