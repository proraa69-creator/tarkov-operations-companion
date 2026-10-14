import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/raidos-settings-test' } }))
const { DEFAULT_SETTINGS, minimapOn, sanitize } = await import('./settings')

describe('overlay settings: the app keeps no key of its own to press (owner, 14.10.2026)', () => {
  it('drops the screenshot key older settings files saved: the player presses the game\'s own key', () => {
    expect('screenshotKey' in DEFAULT_SETTINGS).toBe(false)
    expect('screenshotKey' in sanitize({ version: 4, screenshotKey: 'F12' })).toBe(false)
    expect('screenshotKey' in sanitize({ version: 3, screenshotKey: '' })).toBe(false)
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
