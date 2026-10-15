import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/raidos-settings-test' } }))
const { DEFAULT_SETTINGS, remoteMinimapOn, sanitize, setRemoteMinimap, trackingOn } = await import('./settings')

describe('settings: the app keeps no key of its own to press (owner, 14.10.2026)', () => {
  it('drops the screenshot key older settings files saved: the player presses the game\'s own key', () => {
    expect('screenshotKey' in DEFAULT_SETTINGS).toBe(false)
    expect('screenshotKey' in sanitize({ version: 4, screenshotKey: 'F12' })).toBe(false)
    expect('screenshotKey' in sanitize({ version: 3, screenshotKey: '' })).toBe(false)
  })
})

describe('no overlays (owner, 15.10.2026: «убирай функции оверлей, карта поверх игры и информация о предмете поверх игры»)', () => {
  it('drops the minimap window\'s key, opacity, size, place and «show on screenshot» from older settings files', () => {
    const old = sanitize({ version: 4, minimapKey: 'KeyM', minimapOpacity: 0.5, minimapWidth: 600, minimapPosition: { x: 10, y: 20 }, showOnScreenshot: true, itemKey: 'KeyK', collectorKey: 'F7', playerMarker: 'dot' })
    for (const key of ['minimapKey', 'minimapOpacity', 'minimapWidth', 'minimapPosition', 'showOnScreenshot']) expect(key in old, key).toBe(false)
    for (const key of ['minimapKey', 'minimapOpacity', 'minimapWidth', 'minimapPosition', 'showOnScreenshot']) expect(key in DEFAULT_SETTINGS, key).toBe(false)
    // What still makes sense stays: the item key, the Collector key and how the player's dot is drawn on the maps.
    expect([old.version, old.itemKey, old.collectorKey, old.playerMarker]).toEqual([5, 'KeyK', 'F7', 'dot'])
  })
})

describe('«Отключить местоположение» (was «Отключить мини-карту», owner, 14.10.2026)', () => {
  beforeAll(() => setRemoteMinimap(true))
  afterAll(() => setRemoteMinimap(false))

  it('is on by default, and an old `minimap: false` from before the switch was removed does not turn it off', () => {
    expect(DEFAULT_SETTINGS.minimapOff).toBe(false)
    expect(trackingOn(sanitize({}))).toBe(true)
    expect(trackingOn(sanitize({ version: 3, minimap: false }))).toBe(true)
  })

  it('stays off once the player turned it off, until turned on again', () => {
    const off = sanitize({ ...sanitize({}), minimapOff: true })
    expect(trackingOn(off)).toBe(false)
    expect(trackingOn(sanitize({ ...off }))).toBe(false)
    expect(trackingOn(sanitize({ ...off, minimapOff: false }))).toBe(true)
    expect(sanitize({ minimapOff: 'yes' }).minimapOff).toBe(false)
  })
})

describe('the owner\'s switch for every app (owner, 14.10.2026: «у всех по стандарту функция миникарты выключена»)', () => {
  afterEach(() => setRemoteMinimap(false))

  it('is off until the app learns it is on: no screenshots folder watch and no position', () => {
    expect(remoteMinimapOn()).toBe(false)
    expect(trackingOn(sanitize({}))).toBe(false)
  })

  it('gates the tracking like «Отключить местоположение»: on only when both allow it', () => {
    const on = sanitize({})
    const playerOff = sanitize({ minimapOff: true })
    setRemoteMinimap(true)
    expect([trackingOn(on), trackingOn(playerOff)]).toEqual([true, false])
    setRemoteMinimap(false)
    expect([trackingOn(on), trackingOn(playerOff)]).toEqual([false, false])
    // The player's own switch is kept as it was: on again with the owner's switch.
    expect(on.minimapOff).toBe(false)
    expect(trackingOn(on, true)).toBe(true)
  })
})
