import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkAnnouncementNow, followAnnouncement } from './announcement'
import { markMinimapNoticeSeen, minimapNoticeDue, parseFeatures, reloadRemoteFeaturesForTests, remoteFeatures, sendRemoteFeaturesToMain } from './features'

// The owner's switches for every app, with the notice's answer (server/src/routes/announcement.ts, 14.10.2026).
const setRemoteMinimap = vi.fn(async (enabled: boolean) => enabled)
const noSleep = async () => {}
const answer = (minimap?: boolean, minimapChangedAt: string | null = null) => ({ version: 1, announcement: null, ...(minimap === undefined ? {} : { features: { minimap, minimapChangedAt } }) })

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
    expect(parseFeatures(answer(true, '2026-10-14T10:00:00.000Z'))).toEqual({ minimap: true, minimapChangedAt: '2026-10-14T10:00:00.000Z' })
    expect(parseFeatures(answer(false))).toEqual({ minimap: false, minimapChangedAt: '' })
    expect(parseFeatures(answer())).toBeNull()
    expect(parseFeatures({ features: { minimap: 'yes' } })).toBeNull()
    expect(parseFeatures(null)).toBeNull()
  })

  it('off until known; the server\'s answer reaches the pages, this installation and the main process', async () => {
    expect(remoteFeatures()).toEqual({ minimap: false, minimapChangedAt: '', known: false })
    // The app opens: the main process gets the last known value (off: none known).
    sendRemoteFeaturesToMain()
    expect(setRemoteMinimap).toHaveBeenLastCalledWith(false)

    await followAnnouncement(async () => answer(true), noSleep, 1)
    expect(remoteFeatures()).toEqual({ minimap: true, minimapChangedAt: '', known: true })
    expect(setRemoteMinimap).toHaveBeenLastCalledWith(true)

    // A start without network: the last known value, at once.
    reloadRemoteFeaturesForTests()
    expect(remoteFeatures()).toEqual({ minimap: true, minimapChangedAt: '', known: true })
    sendRemoteFeaturesToMain()
    expect(setRemoteMinimap).toHaveBeenLastCalledWith(true)

    // Offline, or a server without the field: nothing changes.
    await followAnnouncement(async () => { throw new Error('offline') }, noSleep, 1)
    await followAnnouncement(async () => answer(), noSleep, 1)
    expect(remoteFeatures().minimap).toBe(true)

    await followAnnouncement(async () => answer(false, '2026-10-14T11:00:00.000Z'), noSleep, 1)
    expect(remoteFeatures()).toEqual({ minimap: false, minimapChangedAt: '2026-10-14T11:00:00.000Z', known: true })
    expect(setRemoteMinimap).toHaveBeenLastCalledWith(false)
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
