import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/raidos-settings-test' } }))
const { DEFAULT_SETTINGS, minimapOn, sanitize } = await import('./settings')

describe('overlay settings: the key the app presses for a screenshot', () => {
  it('is PrtSc, the game’s standard key, by default and for settings saved before (owner, 10.10.2026)', () => {
    expect(DEFAULT_SETTINGS.screenshotKey).toBe('Print')
    expect(sanitize({}).screenshotKey).toBe('Print')
    expect(sanitize({ version: 3, screenshotKey: '' }).screenshotKey).toBe('Print')
    expect(sanitize({ version: 3 }).screenshotKey).toBe('Print')
  })

  it('keeps a key the player chose, and «По настройкам игры» picked after the change', () => {
    expect(sanitize({ version: 3, screenshotKey: 'F12' }).screenshotKey).toBe('F12')
    expect(sanitize({ version: 4, screenshotKey: '' }).screenshotKey).toBe('')
    expect(sanitize({ version: 4, screenshotKey: 'Nope' }).screenshotKey).toBe('Print')
    // Saving again keeps the choice: the saved settings are version 4.
    expect(sanitize({ ...sanitize({ version: 4, screenshotKey: '' }) }).screenshotKey).toBe('')
  })

  it('the minimap still opens only by its key (M)', () => {
    const settings = sanitize({ version: 3, minimapKey: 'KeyM', showOnScreenshot: true })
    expect([settings.minimapKey, settings.showOnScreenshot]).toEqual(['KeyM', false])
  })
})

describe('«Отключить мини-карту» (owner, 14.10.2026)', () => {
  it('is on by default, and an old `minimap: false` from before the switch was removed does not turn it off', () => {
    expect(DEFAULT_SETTINGS.minimapOff).toBe(false)
    expect(minimapOn(sanitize({}))).toBe(true)
    expect(minimapOn(sanitize({ version: 3, minimap: false }))).toBe(true)
  })

  it('stays off once the player turned it off, until turned on again', () => {
    const off = sanitize({ ...sanitize({}), minimapOff: true })
    expect(minimapOn(off)).toBe(false)
    expect(minimapOn(sanitize({ ...off }))).toBe(false)
    expect(minimapOn(sanitize({ ...off, minimapOff: false }))).toBe(true)
    expect(sanitize({ minimapOff: 'yes' }).minimapOff).toBe(false)
  })
})
