import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webServiceRequest } from './webAccount'

/** The phone's (and the browser preview's) transport: only whitelisted paths, personal ones with the stored session. */
const SESSION_KEY = 'tarkov-mobile-session-v1'
const token = 'a'.repeat(43)

describe('phone transport: «Чат с поддержкой» (server/src/routes/supportChat.ts)', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  it('sends the player\'s chat with his session; nothing goes out signed out; the owner\'s chat routes are not on the phone\'s list', async () => {
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

    for (const [method, path] of [['GET', '/v1/me/support/messages?after=x'], ['PUT', '/v1/me/support/messages'], ['GET', '/v1/me/support/read'], ['GET', '/v1/accounts/me/admin/support/threads?limit=100']] as const) {
      await expect(webServiceRequest(method, path)).rejects.toThrow('Неизвестный запрос сервиса')
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
