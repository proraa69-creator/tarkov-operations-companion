import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createModeProgress } from '../domain/progress'
import type { ModeProgress, PlayerProfileSnapshot, RaidMode } from '../domain/types'
import { refreshServerStatus, usesWebAccount } from '../sync/serverSync'
import { SHARE_LEVELS_DELAY_MS, SHARE_LEVELS_PATH, sharedLevelsOf, useShareLevels } from './useShareLevels'

/** The phone app: Capacitor's native platform, signed in over fetch (sync/webAccount.ts). */
const phone = vi.hoisted(() => ({ native: false, request: vi.fn() }))
vi.mock('../platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('../platform')>()), isNative: () => phone.native }))
vi.mock('../sync/webAccount', async (importOriginal) => ({ ...(await importOriginal<typeof import('../sync/webAccount')>()), webServiceRequest: phone.request }))

const SCREEN_AT = '2026-10-13T18:00:00.000Z'
const DEV_AT = '2026-10-12T09:00:00.000Z'
const snapshot = (level: number, prestige: number): PlayerProfileSnapshot => ({ accountId: 7690289, nickname: 'Wolfhound', experience: 1_000_000, level, faction: 'usec', prestige, fetchedAt: DEV_AT, upstreamUpdatedAt: DEV_AT })

type Modes = Record<RaidMode, ModeProgress>
function modes(patch: Partial<Record<RaidMode, Partial<ModeProgress>>> = {}): Modes {
  return { pvp: { ...createModeProgress(), ...patch.pvp }, pve: { ...createModeProgress(), ...patch.pve }, seasonal: { ...createModeProgress(), ...patch.seasonal } }
}
/** PvP read from the game's screen (no prestige there) and raised by quests since; PvE from Tarkov.dev; Season not known. */
const known = (pvpLevel = 41) => modes({
  pvp: { playerLevel: pvpLevel, levelAnchor: { level: 40, observedAt: SCREEN_AT, source: 'screen', checked: true } },
  pve: { playerLevel: 39, prestige: 2, playerSnapshot: snapshot(39, 2), levelAnchor: { level: 39, observedAt: DEV_AT, source: 'tarkov-dev', experience: 1_000_000 } },
})

describe('sharedLevelsOf', () => {
  it('shares only the modes whose level is known; the prestige only from a Tarkov.dev profile', () => {
    expect(sharedLevelsOf(known())).toEqual({
      pvp: { level: 41, prestige: null, observedAt: SCREEN_AT },
      pve: { level: 39, prestige: 2, observedAt: DEV_AT },
    })
    // Level 1 and prestige 0 of a mode nothing was read for are defaults, not a level.
    expect(sharedLevelsOf(modes())).toEqual({})
  })

  it('leaves out what the server would refuse', () => {
    expect(sharedLevelsOf(modes({
      pvp: { playerLevel: 80, levelAnchor: { level: 80, observedAt: SCREEN_AT, source: 'screen' } },
      pve: { playerLevel: 20, levelAnchor: { level: 20, observedAt: 'not a date', source: 'screen' } },
      seasonal: { playerLevel: 12, prestige: 42, playerSnapshot: snapshot(12, 42), levelAnchor: { level: 12, observedAt: '2026-10-13T21:00:00+03:00', source: 'tarkov-dev' } },
    }))).toEqual({ seasonal: { level: 12, prestige: null, observedAt: SCREEN_AT } })
  })
})

describe('useShareLevels', () => {
  const serviceRequest = vi.fn()
  const status = vi.fn()
  const signedIn = { signedIn: true, email: 'a@example.com', kind: 'user', online: true, serverUrl: 'https://raidos.app', persistent: true }
  const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  const mount = (value: Modes) => renderHook(({ current }) => useShareLevels(current), { initialProps: { current: value } })

  beforeEach(async () => {
    serviceRequest.mockReset()
    serviceRequest.mockResolvedValue({ modes: {} })
    status.mockReset()
    status.mockResolvedValue(signedIn)
    Object.assign(window, { tarkovDesktop: { serviceRequest, account: { status } } })
    await refreshServerStatus()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'tarkovDesktop')
    phone.native = false
    phone.request.mockReset()
  })

  it('sends the known modes once after start, a few seconds after the last change, and again only when a value changes', async () => {
    const { rerender } = mount(known(40))
    await wait(SHARE_LEVELS_DELAY_MS - 1000)
    // The quests raise PvP before the quiet time is over: one request, with the newest values.
    rerender({ current: known(41) })
    await wait(SHARE_LEVELS_DELAY_MS - 1)
    expect(serviceRequest).not.toHaveBeenCalled()
    await wait(1)
    expect(serviceRequest).toHaveBeenCalledTimes(1)
    expect(serviceRequest).toHaveBeenCalledWith('PUT', SHARE_LEVELS_PATH, { modes: { pvp: { level: 41, prestige: null, observedAt: SCREEN_AT }, pve: { level: 39, prestige: 2, observedAt: DEV_AT } } })
    // The same values in a new profile object, and time alone: nothing (no polling).
    rerender({ current: known(41) })
    await wait(10 * SHARE_LEVELS_DELAY_MS)
    expect(serviceRequest).toHaveBeenCalledTimes(1)
    // A new level goes again.
    rerender({ current: known(42) })
    await wait(SHARE_LEVELS_DELAY_MS)
    expect(serviceRequest).toHaveBeenCalledTimes(2)
    expect(serviceRequest).toHaveBeenLastCalledWith('PUT', SHARE_LEVELS_PATH, { modes: { pvp: { level: 42, prestige: null, observedAt: SCREEN_AT }, pve: { level: 39, prestige: 2, observedAt: DEV_AT } } })
  })

  it('sends nothing until a level is known and the account is signed in', async () => {
    status.mockResolvedValue({ ...signedIn, signedIn: false, email: undefined })
    await act(async () => { await refreshServerStatus() })
    const { rerender } = mount(modes())
    await wait(3 * SHARE_LEVELS_DELAY_MS)
    rerender({ current: known() })
    await wait(3 * SHARE_LEVELS_DELAY_MS)
    expect(serviceRequest).not.toHaveBeenCalled()
    status.mockResolvedValue(signedIn)
    await act(async () => { await refreshServerStatus() })
    await wait(SHARE_LEVELS_DELAY_MS)
    expect(serviceRequest).toHaveBeenCalledTimes(1)
  })

  it('tries a send that did not get through again only on the next change, never in a loop', async () => {
    // An app whose gateway does not know the path yet refuses it at once.
    serviceRequest.mockRejectedValue(new Error("Error invoking remote method 'service:request': Error: Неизвестный запрос сервиса"))
    const { rerender } = mount(known())
    await wait(SHARE_LEVELS_DELAY_MS)
    expect(serviceRequest).toHaveBeenCalledTimes(1)
    await wait(10 * SHARE_LEVELS_DELAY_MS)
    expect(serviceRequest).toHaveBeenCalledTimes(1)
    serviceRequest.mockResolvedValue({ modes: {} })
    rerender({ current: known(42) })
    await wait(SHARE_LEVELS_DELAY_MS)
    expect(serviceRequest).toHaveBeenCalledTimes(2)
  })

  it('does not run on the phone', async () => {
    // Signed in (the account store says so), no desktop shell: the phone, which would reach the server over fetch.
    Reflect.deleteProperty(window, 'tarkovDesktop')
    phone.native = true
    phone.request.mockResolvedValue({ modes: {} })
    expect(usesWebAccount()).toBe(true)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      const { rerender } = mount(known())
      await wait(3 * SHARE_LEVELS_DELAY_MS)
      rerender({ current: known(42) })
      await wait(3 * SHARE_LEVELS_DELAY_MS)
      expect(phone.request).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(serviceRequest).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
