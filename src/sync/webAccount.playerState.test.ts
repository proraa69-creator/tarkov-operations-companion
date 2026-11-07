import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webServiceRequest } from './webAccount'

/** The player's own lists (src/sync/playerState.ts): a route missing from the phone's list would fail without a word. */
const SESSION_KEY = 'tarkov-mobile-session-v1'
const token = 'a'.repeat(43)

describe('phone transport: the player\'s own lists', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  it('GET and POST /v1/me/state and the wait with the counter go out with the session; nothing else on them passes', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ rev: 1, items: [], more: false, version: 1, state: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await webServiceRequest('POST', '/v1/me/state', { since: 0, items: [] })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, email: 'player@example.com', kind: 'user' }))
    await webServiceRequest('POST', '/v1/me/state', { since: 0, items: [] })
    await webServiceRequest('GET', '/v1/me/state?since=12')
    await webServiceRequest('GET', '/v1/me/social-events?since=5&state=12')
    await webServiceRequest('GET', '/v1/me/social-events?since=5')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://raidos.app/v1/me/state', 'https://raidos.app/v1/me/state?since=12',
      'https://raidos.app/v1/me/social-events?since=5&state=12', 'https://raidos.app/v1/me/social-events?since=5',
    ])
    await expect(webServiceRequest('DELETE', '/v1/me/state')).rejects.toThrow('Неизвестный запрос сервиса')
    await expect(webServiceRequest('GET', '/v1/me/state?since=x')).rejects.toThrow('Неизвестный запрос сервиса')
    await expect(webServiceRequest('GET', '/v1/me/social-events?state=12')).rejects.toThrow('Неизвестный запрос сервиса')
  })
})
