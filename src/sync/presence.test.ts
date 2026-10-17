import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRESENCE_HEARTBEAT_MS, PRESENCE_PATH, usePresenceHeartbeat } from './presence'
import { refreshServerStatus } from './serverSync'

/** «Онлайн сейчас»: the app's heartbeat while its user is signed in (server/src/routes/presence.ts). */
const signedIn = { signedIn: true, email: 'player@example.com', kind: 'user', online: true, serverUrl: 'https://raidos.app', persistent: true }
const signedOut = { signedIn: false, online: true, serverUrl: 'https://raidos.app', persistent: true }

async function desktop(status: unknown) {
  const serviceRequest = vi.fn().mockResolvedValue(null)
  Object.assign(window, { tarkovDesktop: { isDesktop: true, edition: 'client', serviceRequest, account: { status: vi.fn().mockResolvedValue(status), login: vi.fn(), logout: vi.fn() } } })
  await refreshServerStatus()
  return serviceRequest
}
const beats = (request: ReturnType<typeof vi.fn>) => request.mock.calls.filter(([method, path]) => method === 'POST' && path === PRESENCE_PATH).length

describe('usePresenceHeartbeat', () => {
  afterEach(async () => {
    cleanup()
    vi.useRealTimers()
    await desktop(signedOut)
    Reflect.deleteProperty(window, 'tarkovDesktop')
  })

  it('the signed-in desktop app beats at once and then about once a minute, and stops when unmounted', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const request = await desktop(signedIn)
    const hook = renderHook(() => usePresenceHeartbeat())
    expect(beats(request)).toBe(1)
    act(() => { vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS) })
    expect(beats(request)).toBe(2)
    act(() => { vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 2) })
    expect(beats(request)).toBe(4)
    hook.unmount()
    act(() => { vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 3) })
    expect(beats(request)).toBe(4)
  })

  it('a failing beat (an older server, no connection) is quiet', async () => {
    const request = await desktop(signedIn)
    request.mockRejectedValue(new Error('Сервис недоступен: 404'))
    renderHook(() => usePresenceHeartbeat())
    expect(beats(request)).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 10))
  })

  it('nothing while signed out, and nothing from a plain browser (the website and the browser preview)', async () => {
    const request = await desktop(signedOut)
    renderHook(() => usePresenceHeartbeat())
    expect(beats(request)).toBe(0)
    cleanup()
    Reflect.deleteProperty(window, 'tarkovDesktop')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderHook(() => usePresenceHeartbeat())
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes(PRESENCE_PATH))).toBe(false)
    fetchSpy.mockRestore()
  })
})
