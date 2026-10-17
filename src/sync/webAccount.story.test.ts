import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webServiceRequest } from './webAccount'

/**
 * Story chapters and «Ручная отметка» (src/sync/serverSync.ts syncStory / syncManualMarks): the phone's whitelist let
 * neither through, so the requests failed without a word and the phone never got the PC's chapters or marks.
 */
const SESSION_KEY = 'tarkov-mobile-session-v1'
const token = 'a'.repeat(43)

describe('phone transport: story chapters and manual marks', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  it('POST /v1/me/story/:mode and /v1/me/progress/:mode/manual go out with the session; other modes do not pass', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ records: [], marks: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, email: 'player@example.com', kind: 'user' }))

    await webServiceRequest('POST', '/v1/me/story/pvp', { records: [] })
    await webServiceRequest('POST', '/v1/me/progress/seasonal/manual', { marks: [] })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://raidos.app/v1/me/story/pvp', 'https://raidos.app/v1/me/progress/seasonal/manual'])
    await expect(webServiceRequest('POST', '/v1/me/story/arena', { records: [] })).rejects.toThrow('Неизвестный запрос сервиса')
    await expect(webServiceRequest('DELETE', '/v1/me/progress/pve/manual')).rejects.toThrow('Неизвестный запрос сервиса')
  })
})
