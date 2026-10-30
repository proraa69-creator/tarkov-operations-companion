import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Halloween scheme', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules() })
  afterEach(() => { vi.useRealTimers() })

  it('opens on «Кровавая луна» during Halloween whatever was saved; a pick lasts, and is saved for after', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-31T12:00:00Z'), toFake: ['Date'] })
    localStorage.setItem('tarkov-app-theme', 'gear')
    const theme = await import('./theme')
    expect(theme.currentTheme()).toBe('bloodmoon')
    expect(theme.savedTheme()).toBe('gear')
    theme.saveAppearance('telnyashka')
    expect(theme.currentTheme()).toBe('telnyashka')
    expect(document.documentElement.dataset.theme).toBe('telnyashka')
  })

  it('a choice from the account is saved but does not replace the Halloween scheme', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-05T12:00:00Z'), toFake: ['Date'] })
    const theme = await import('./theme')
    theme.saveAppearance('gear', { picked: false })
    expect(theme.savedTheme()).toBe('gear')
    expect(theme.currentTheme()).toBe('bloodmoon')
  })

  it('the player\'s own scheme outside Halloween (Moscow days)', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-11T21:30:00Z'), toFake: ['Date'] })
    localStorage.setItem('tarkov-app-theme', 'gear')
    const theme = await import('./theme')
    expect(theme.currentTheme()).toBe('gear')
  })
})
