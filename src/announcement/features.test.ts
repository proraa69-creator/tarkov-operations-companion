import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkAnnouncementNow, followAnnouncement } from './announcement'
import { parseFeatures, reloadRemoteFeaturesForTests, remoteFeatures, RESEND_MS, sendRemoteFeaturesToMain, setRemoteFeatures } from './features'

// The owner's position switch for every app, with the notice's answer (server/src/routes/announcement.ts, 14.10.2026).
const setRemoteMinimap = vi.fn(async (...args: [enabled: boolean]) => args[0])
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

describe('the owner\'s position switch in the app', () => {
  it('reads the answer\'s `features`; a server from before sends none; the window-over-the-game switch is ignored', () => {
    expect(parseFeatures(answer(true, '2026-10-14T10:00:00.000Z'))).toEqual({ minimap: true, minimapChangedAt: '2026-10-14T10:00:00.000Z' })
    expect(parseFeatures(answer(false))).toEqual({ minimap: false, minimapChangedAt: '' })
    // `minimapOverlay` is for the apps from before 15.10.2026: this app draws nothing over the game.
    expect(parseFeatures(answer(true, null, false))).toEqual({ minimap: true, minimapChangedAt: '' })
    expect(parseFeatures(answer())).toBeNull()
    expect(parseFeatures({ features: { minimap: 'yes' } })).toBeNull()
    expect(parseFeatures(null)).toBeNull()
  })

  it('off until known; the server\'s answer reaches the pages, this installation and the main process', async () => {
    expect(remoteFeatures()).toEqual({ minimap: false, minimapChangedAt: '', known: false })
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

  it('asks between the regular checks, never twice at once or too often', async () => {
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

  it('the switch reaches a main process whose handler was not there yet (the window loads before the game functions start)', async () => {
    vi.useFakeTimers()
    // Turned on by the owner (now or at an earlier start), sent as the window opens: the handler does not exist yet.
    setRemoteFeatures({ minimap: true, minimapChangedAt: '' })
    reloadRemoteFeaturesForTests()
    let ready = false
    setRemoteMinimap.mockImplementation(async (enabled: boolean) => {
      if (!ready) throw new Error("No handler registered for 'experimental:set-remote-minimap'")
      return enabled
    })
    setRemoteMinimap.mockClear()
    sendRemoteFeaturesToMain()
    await vi.advanceTimersByTimeAsync(0)
    expect(setRemoteMinimap).toHaveBeenCalledTimes(1)
    // Not left until the next server answer minutes later: tried again soon, until it gets through.
    await vi.advanceTimersByTimeAsync(RESEND_MS)
    expect(setRemoteMinimap).toHaveBeenCalledTimes(2)
    ready = true
    await vi.advanceTimersByTimeAsync(RESEND_MS)
    expect(setRemoteMinimap).toHaveBeenCalledTimes(3)
    expect(setRemoteMinimap).toHaveBeenLastCalledWith(true)
    // Through: nothing more is sent.
    await vi.advanceTimersByTimeAsync(RESEND_MS * 5)
    expect(setRemoteMinimap).toHaveBeenCalledTimes(3)
    // The owner turns it off later: sent at once.
    setRemoteFeatures({ minimap: false, minimapChangedAt: '2026-10-16T10:00:00.000Z' })
    expect(setRemoteMinimap).toHaveBeenLastCalledWith(false)
    setRemoteMinimap.mockImplementation(async (...args: [enabled: boolean]) => args[0])
  })
})
