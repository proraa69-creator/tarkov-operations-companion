import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UPDATE_HISTORY_PATH } from '../shared/updateHistory'
import { webServiceRequest } from './webAccount'

/** The phone's and the admin app's transport lets only listed paths through: «История обновлений» is one of them. */
const SESSION_KEY = 'tarkov-mobile-session-v1'
const token = 'a'.repeat(43)

describe('phone transport: «История обновлений»', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  it('only GET of the exact path, with the session; without a session nothing is sent', async () => {
    const fetched = vi.fn(async () => new Response(JSON.stringify({ versions: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetched)

    expect(await webServiceRequest('GET', UPDATE_HISTORY_PATH)).toBeNull()
    expect(fetched).not.toHaveBeenCalled()

    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, email: 'owner@example.com', kind: 'user' }))
    expect(await webServiceRequest('GET', UPDATE_HISTORY_PATH)).toEqual({ versions: [] })
    const [url, init] = fetched.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://raidos.app${UPDATE_HISTORY_PATH}`)
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`)

    await expect(webServiceRequest('POST', UPDATE_HISTORY_PATH, {})).rejects.toThrow()
    await expect(webServiceRequest('GET', `${UPDATE_HISTORY_PATH}?all=1`)).rejects.toThrow()
    expect(fetched).toHaveBeenCalledTimes(1)
  })
})
