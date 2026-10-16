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

  it('a player\'s earlier «Отключить местоположение» no longer counts: only the owner turns it off (owner, 16.10.2026)', () => {
    const saved = sanitize({ ...sanitize({}), minimapOff: true })
    expect(saved.minimapOff).toBe(false)
    expect(trackingOn(saved)).toBe(true)
    expect(trackingOn({ minimap: true, minimapOff: true } as Parameters<typeof trackingOn>[0])).toBe(true)
  })
})

describe('the owner\'s switch for every app (owner, 14.10.2026: «у всех по стандарту функция миникарты выключена»)', () => {
  afterEach(() => setRemoteMinimap(false))

  it('is off until the app learns it is on: no screenshots folder watch and no position', () => {
    expect(remoteMinimapOn()).toBe(false)
    expect(trackingOn(sanitize({}))).toBe(false)
  })

  it('alone decides the tracking: a player\'s saved «выключено» does not hold it back', () => {
    const on = sanitize({})
    const playerOff = sanitize({ minimapOff: true })
    setRemoteMinimap(true)
    expect([trackingOn(on), trackingOn(playerOff)]).toEqual([true, true])
    setRemoteMinimap(false)
    expect([trackingOn(on), trackingOn(playerOff)]).toEqual([false, false])
    expect(trackingOn(on, true)).toBe(true)
  })
})
