import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkAnnouncementNow, followAnnouncement } from './announcement'
import { markMinimapNoticeSeen, minimapNoticeDue, parseFeatures, reloadRemoteFeaturesForTests, remoteFeatures, sendRemoteFeaturesToMain } from './features'

// The owner's switches for every app, with the notice's answer (server/src/routes/announcement.ts, 14.10.2026).
const setRemoteMinimap = vi.fn(async (...args: [enabled: boolean, overlay?: boolean]) => args[0])
const noSleep = async () => {}
const answer = (minimap?: boolean, minimapChangedAt: string | null = null, minimapOverlay?: boolean) => ({ version: 1, announcement: null, ...(minimap === undefined ? {} : { features: { minimap, minimapChangedAt, ...(minimapOverlay === undefined ? {} : { minimapOverlay }) } }) })

beforeEach(() => {
  vi.stubGlobal('tarkovDesktop', { experimental: { setRemoteMinimap } })
  localStorage.clear()
  reloadRemoteFeaturesForTests()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.useRealTimers()
  localStorage.clear()
  reloadRemoteFeaturesForTests()
})

describe('the owner\'s minimap switch in the app', () => {
  it('reads the answer\'s `features`; a server from before sends none', () => {
    expect(parseFeatures(answer(true, '2026-10-14T10:00:00.000Z'))).toEqual({ minimap: true, minimapChangedAt: '2026-10-14T10:00:00.000Z', minimapOverlay: true })
    expect(parseFeatures(answer(false))).toEqual({ minimap: false, minimapChangedAt: '', minimapOverlay: true })
    expect(parseFeatures(answer())).toBeNull()
    expect(parseFeatures({ features: { minimap: 'yes' } })).toBeNull()
    expect(parseFeatures(null)).toBeNull()
  })

  it('off until known; the server\'s answer reaches the pages, this installation and the main process', async () => {
    expect(remoteFeatures()).toEqual({ minimap: false, minimapChangedAt: '', minimapOverlay: true, known: false })
    // The app opens: the main process gets the last known value (off: none known).
    sendRemoteFeaturesToMain()
    expect(setRemoteMinimap).toHaveBeenLastCalledWith(false, true)

    await followAnnouncement(async () => answer(true), noSleep, 1)
    expect(remoteFeatures()).toEqual({ minimap: true, minimapChangedAt: '', minimapOverlay: true, known: true })
    expect(setRemoteMinimap).toHaveBeenLastCalledWith(true, true)

    // A start without network: the last known value, at once.
    reloadRemoteFeaturesForTests()
    expect(remoteFeatures()).toEqual({ minimap: true, minimapChangedAt: '', minimapOverlay: true, known: true })
    sendRemoteFeaturesToMain()
    expect(setRemoteMinimap).toHaveBeenLastCalledWith(true, true)

    // Offline, or a server without the field: nothing changes.
    await followAnnouncement(async () => { throw new Error('offline') }, noSleep, 1)
    await followAnnouncement(async () => answer(), noSleep, 1)
    expect(remoteFeatures().minimap).toBe(true)

    await followAnnouncement(async () => answer(false, '2026-10-14T11:00:00.000Z'), noSleep, 1)
    expect(remoteFeatures()).toEqual({ minimap: false, minimapChangedAt: '2026-10-14T11:00:00.000Z', minimapOverlay: true, known: true })
    expect(setRemoteMinimap).toHaveBeenLastCalledWith(false, true)
  })

  it('the window switch: on when a server or a stored value from before has none; passed to the main process', async () => {
    expect(parseFeatures(answer(true, null, false))).toEqual({ minimap: true, minimapChangedAt: '', minimapOverlay: false })
    localStorage.setItem('raidos.remoteFeatures.v1', JSON.stringify({ minimap: true, minimapChangedAt: '' }))
    reloadRemoteFeaturesForTests()
    expect(remoteFeatures()).toEqual({ minimap: true, minimapChangedAt: '', minimapOverlay: true, known: true })

    await followAnnouncement(async () => answer(true, null, false), noSleep, 1)
    expect(remoteFeatures().minimapOverlay).toBe(false)
    expect(setRemoteMinimap).toHaveBeenLastCalledWith(true, false)
    // Kept for a start without network.
    reloadRemoteFeaturesForTests()
    expect(remoteFeatures().minimapOverlay).toBe(false)
    // The window alone off: no one-time notice (that is for the whole minimap).
    expect(minimapNoticeDue()).toBe(false)
  })

  it('the one-time notice: due while off and unseen; seen for this switch-off only', async () => {
    expect(minimapNoticeDue()).toBe(false)
    await followAnnouncement(async () => answer(false), noSleep, 1)
    expect(minimapNoticeDue()).toBe(true)
    markMinimapNoticeSeen()
    expect(minimapNoticeDue()).toBe(false)
    await followAnnouncement(async () => answer(true), noSleep, 1)
    expect(minimapNoticeDue()).toBe(false)
    await followAnnouncement(async () => answer(false, '2026-10-15T08:00:00.000Z'), noSleep, 1)
    expect(minimapNoticeDue()).toBe(true)
  })

  it('asks between the regular checks (the Mini Map page, the focus), never twice at once or too often', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T12:00:00Z'))
    const ask = vi.fn(async () => answer(true))
    await Promise.all([checkAnnouncementNow(0, ask), checkAnnouncementNow(0, ask)])
    expect(ask).toHaveBeenCalledTimes(1)
    expect(remoteFeatures().minimap).toBe(true)
    await checkAnnouncementNow(30_000, ask)
    expect(ask).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2030-01-01T12:00:31Z'))
    await checkAnnouncementNow(30_000, ask)
    expect(ask).toHaveBeenCalledTimes(2)
  })
})
