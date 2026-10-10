import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/raidos-settings-test' } }))
const { DEFAULT_SETTINGS, sanitize } = await import('./settings')

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
