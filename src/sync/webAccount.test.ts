import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webServiceRequest } from './webAccount'

/** The phone's (and the browser preview's) transport: only whitelisted paths, personal ones with the stored session. */
const SESSION_KEY = 'tarkov-mobile-session-v1'
const token = 'a'.repeat(43)

describe('phone transport: «Чат с поддержкой» (server/src/routes/supportChat.ts)', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  it('sends player and owner chat requests with the session; malformed or unsupported routes stay blocked', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => (url.endsWith('/read')
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify(init.method === 'POST' ? { message: { id: 5 } } : { messages: [], unread: 0 }), { status: init.method === 'POST' ? 201 : 200, headers: { 'content-type': 'application/json' } })))
    vi.stubGlobal('fetch', fetchMock)

    expect(await webServiceRequest('GET', '/v1/me/support/messages')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, email: 'player@example.com', kind: 'user' }))
    expect(await webServiceRequest('GET', '/v1/me/support/messages?after=12')).toEqual({ messages: [], unread: 0 })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://raidos.app/v1/me/support/messages?after=12')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`)
    expect(await webServiceRequest('POST', '/v1/me/support/messages', { text: 'Привет' })).toEqual({ message: { id: 5 } })
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body))).toEqual({ text: 'Привет' })
    // 204 No Content: null, like the desktop gateway.
    expect(await webServiceRequest('POST', '/v1/me/support/read')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    // The same phone build exposes the owner chat only when the server validates this session as an owner.
    await webServiceRequest('GET', '/v1/accounts/me/admin/support/threads?limit=100')
    expect(((fetchMock.mock.calls[3]![1].headers as Record<string, string>).authorization)).toBe(`Bearer ${token}`)

    for (const [method, path] of [['GET', '/v1/me/support/messages?after=x'], ['PUT', '/v1/me/support/messages'], ['GET', '/v1/me/support/read'], ['GET', '/v1/accounts/me/admin/support/threads/not-an-account']] as const) {
      await expect(webServiceRequest(method, path)).rejects.toThrow('Неизвестный запрос сервиса')
    }
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('screenshots: the player and the standalone owner app use their scoped routes', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ mime: 'image/png', data: 'iVBORw0KGgo=', width: 1, height: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const id = 'ab'.repeat(12)
    expect(await webServiceRequest('GET', `/v1/me/support/attachments/${id}`)).toBeNull()
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, email: 'player@example.com', kind: 'user' }))
    expect(await webServiceRequest('GET', `/v1/me/support/attachments/${id}`)).toMatchObject({ mime: 'image/png' })
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect([url, (init.headers as Record<string, string>).authorization]).toEqual([`https://raidos.app/v1/me/support/attachments/${id}`, `Bearer ${token}`])
    expect(await webServiceRequest('GET', `/v1/accounts/me/admin/support/attachments/${id}`)).toMatchObject({ mime: 'image/png' })
    for (const path of ['/v1/me/support/attachments/../x', `/v1/me/support/attachments/${id}?x=1`]) {
      await expect(webServiceRequest('GET', path)).rejects.toThrow('Неизвестный запрос сервиса')
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('phone transport: the owner\'s notice (server/src/routes/announcement.ts)', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  it('goes with the session, so the server answers in the language of the account\'s country; signed out it still comes', async () => {
    const answer = { version: 3, announcement: { text: 'Maintenance is under way.', lang: 'en', updatedAt: '2026-10-14T10:00:00.000Z' } }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const authorization = (call: number) => ((fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[call]![1].headers as Record<string, string>).authorization

    expect(await webServiceRequest('GET', '/v1/announcement')).toEqual(answer)
    expect(authorization(0)).toBeUndefined()

    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, email: 'player@example.com', kind: 'user' }))
    expect(await webServiceRequest('GET', '/v1/announcement')).toEqual(answer)
    expect(await webServiceRequest('GET', '/v1/announcement?since=17')).toEqual(answer)
    expect([authorization(1), authorization(2)]).toEqual([`Bearer ${token}`, `Bearer ${token}`])
    // Other public routes still go without it.
    await webServiceRequest('GET', '/v1/map-updates?since=17')
    expect(authorization(3)).toBeUndefined()
  })
})

describe('phone transport: «Онлайн сейчас» (server/src/routes/presence.ts)', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  it('the heartbeat goes with the session and this device\'s id; the standalone owner app can read the count', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await webServiceRequest('POST', '/v1/me/presence')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, email: 'player@example.com', kind: 'user' }))
    expect(await webServiceRequest('POST', '/v1/me/presence')).toBeNull()
    const [url, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]!
    expect(url).toBe('https://raidos.app/v1/me/presence')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${token}`)
    expect(headers['x-raid-device']).toMatch(/^[A-Za-z0-9_-]{22,64}$/)
    expect(await webServiceRequest('GET', '/v1/accounts/me/admin/online')).toBeNull()
    expect(((fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[1]![1].headers as Record<string, string>)['x-raid-device']).toBeUndefined()
    // Other personal routes still go without the device.
    await webServiceRequest('GET', '/v1/me/settings').catch(() => null)
    expect(((fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[2]![1].headers as Record<string, string>)['x-raid-device']).toBeUndefined()
  })
})
