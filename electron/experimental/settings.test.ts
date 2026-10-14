import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/raidos-settings-test' } }))
const { DEFAULT_SETTINGS, minimapOn, minimapOverlayOn, remoteMinimapOn, remoteOverlayOn, sanitize, setRemoteMinimap } = await import('./settings')

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
  beforeAll(() => setRemoteMinimap(true))
  afterAll(() => setRemoteMinimap(false))

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

describe('the owner\'s switch for every app (owner, 14.10.2026: «у всех по стандарту функция миникарты выключена»)', () => {
  afterEach(() => setRemoteMinimap(false))

  it('is off until the app learns it is on: no minimap, its key, the screenshots folder or the position', () => {
    expect(remoteMinimapOn()).toBe(false)
    expect(minimapOn(sanitize({}))).toBe(false)
  })

  it('gates the minimap like «Отключить мини-карту»: on only when both allow it', () => {
    const on = sanitize({})
    const playerOff = sanitize({ minimapOff: true })
    setRemoteMinimap(true)
    expect([minimapOn(on), minimapOn(playerOff)]).toEqual([true, false])
    setRemoteMinimap(false)
    expect([minimapOn(on), minimapOn(playerOff)]).toEqual([false, false])
    // The player's own switch is kept as it was: on again with the owner's switch.
    expect(on.minimapOff).toBe(false)
    expect(minimapOn(on, true)).toBe(true)
  })
})

describe('the owner\'s window switch (owner, 14.10.2026: «местоположение появляется только в приложении. а всплывающее окно не появляется вообще»)', () => {
  afterEach(() => setRemoteMinimap(false))

  it('on unless the owner turned it off: the first switch alone gives the whole minimap, as before', () => {
    expect(remoteOverlayOn()).toBe(true)
    setRemoteMinimap(true)
    expect([minimapOn(sanitize({})), minimapOverlayOn(sanitize({}))]).toEqual([true, true])
  })

  it('off: no window, no map key, no «Показать / скрыть», but the tracking and the position go on', () => {
    setRemoteMinimap(true, false)
    expect(remoteOverlayOn()).toBe(false)
    expect(minimapOn(sanitize({})), 'tracking').toBe(true)
    expect(minimapOverlayOn(sanitize({})), 'window').toBe(false)
  })

  it('needs the first switch and the player\'s own: everything off stays off', () => {
    setRemoteMinimap(false, true)
    expect([minimapOn(sanitize({})), minimapOverlayOn(sanitize({}))]).toEqual([false, false])
    setRemoteMinimap(true, true)
    expect([minimapOn(sanitize({ minimapOff: true })), minimapOverlayOn(sanitize({ minimapOff: true }))]).toEqual([false, false])
    expect(minimapOverlayOn(sanitize({}), true, false)).toBe(false)
  })
})
