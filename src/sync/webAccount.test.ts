import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isServerUnavailable, onServerAnswer, webAdminAccountStatus, webServiceRequest } from './webAccount'

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

  it('reactions (owner, 07.11.2026): the player\'s and the owner\'s routes go with the session; others stay blocked', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: { id: 5 } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, email: 'player@example.com', kind: 'user' }))
    const owner = `/v1/accounts/me/admin/support/threads/${'ab'.repeat(12)}/messages/5/reactions`
    for (const path of ['/v1/me/support/messages/5/reactions', owner]) {
      expect(await webServiceRequest('POST', path, { emoji: '👍', on: true })).toEqual({ message: { id: 5 } })
    }
    expect(fetchMock.mock.calls.map((call) => (call as unknown as [string])[0])).toEqual(['https://raidos.app/v1/me/support/messages/5/reactions', `https://raidos.app${owner}`])
    for (const [method, path] of [['GET', '/v1/me/support/messages/5/reactions'], ['POST', '/v1/me/support/messages/x/reactions'], ['POST', '/v1/accounts/me/admin/support/threads/not-an-account/messages/5/reactions']] as const) {
      await expect(webServiceRequest(method, path, { emoji: '👍' })).rejects.toThrow('Неизвестный запрос сервиса')
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // Owner, 07.11.2026: «И там я буду делать паки стикеров. Которые по нажатию кнопки добавить будут добавляться в приложение на ПК и телефон».
  it('sticker packs: the picker reads the published ones without a session; the owner\'s routes go with it; others stay blocked', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ packs: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await webServiceRequest('GET', '/v1/stickers')).toEqual({ packs: [] })
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('authorization')).toBeNull()
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, email: 'owner@example.com', kind: 'user' }))
    const pack = 'ab'.repeat(12)
    for (const [method, path] of [
      ['GET', '/v1/accounts/me/admin/stickers'], ['POST', '/v1/accounts/me/admin/stickers/packs'], ['POST', '/v1/accounts/me/admin/stickers/packs/order'],
      ['PUT', `/v1/accounts/me/admin/stickers/packs/${pack}`], ['DELETE', `/v1/accounts/me/admin/stickers/packs/${pack}`],
      ['POST', `/v1/accounts/me/admin/stickers/packs/${pack}/stickers`], ['POST', `/v1/accounts/me/admin/stickers/packs/${pack}/order`], ['DELETE', `/v1/accounts/me/admin/stickers/${pack}`],
    ] as const) {
      await webServiceRequest(method, path, {})
      expect(new Headers(fetchMock.mock.calls.at(-1)![1]?.headers).get('authorization')).toBe(`Bearer ${token}`)
    }
    for (const [method, path] of [
      ['POST', '/v1/stickers'], ['GET', `/v1/stickers/${pack}.png`], ['DELETE', '/v1/accounts/me/admin/stickers/packs/not-a-pack'], ['GET', `/v1/accounts/me/admin/stickers/packs/${pack}`],
      ['PUT', `/v1/accounts/me/admin/stickers/${pack}`], ['POST', `/v1/accounts/me/admin/stickers/packs/${pack}/stickers/1`],
    ] as const) {
      await expect(webServiceRequest(method, path, {})).rejects.toThrow('Неизвестный запрос сервиса')
    }
    expect(fetchMock).toHaveBeenCalledTimes(9)
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

describe('phone transport: «Изменить сумму» in the owner app (server/src/routes/ownerAdmin.ts)', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  it('posts the new amount of one payment with the session; other methods and malformed ids stay blocked', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'c'.repeat(24), amount: 700 }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, email: 'owner@example.com', kind: 'user' }))
    const path = `/v1/accounts/me/admin/payments/${'c'.repeat(24)}/amount`
    expect(await webServiceRequest('POST', path, { amount: 700, comment: 'частичный возврат' })).toEqual({ id: 'c'.repeat(24), amount: 700 })
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect([url, init.method, JSON.parse(String(init.body))]).toEqual([`https://raidos.app${path}`, 'POST', { amount: 700, comment: 'частичный возврат' }])
    for (const [method, bad] of [['GET', path], ['DELETE', path], ['POST', '/v1/accounts/me/admin/payments/not-an-id/amount'], ['POST', `${path}?x=1`]] as const) {
      await expect(webServiceRequest(method, bad)).rejects.toThrow('Неизвестный запрос сервиса')
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// Owner, 03.11.2026: «иногда пишет, что связи нет… долго загружает».
describe('phone transport: the owner app on a slow road to the server', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  it('with a kept session the check is one request (the account), not /health and then the account', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify({ email: 'owner@example.com', kind: 'user', owner: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, email: 'owner@example.com', kind: 'user' }))
    const status = await webAdminAccountStatus()
    expect([status.online, status.signedIn, status.owner]).toEqual([true, true, true])
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['https://raidos.app/v1/accounts/me'])
  })

  it('an answer of the server is announced (the bar says «Сервер подключён»); a 502 of the proxy is no answer and worth one more try', async () => {
    let status = 200
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ reports: [], total: 0, counts: { open: 0, closed: 0 } }), { status, headers: { 'content-type': 'application/json' } })))
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, email: 'owner@example.com', kind: 'user' }))
    const answered = vi.fn()
    const stop = onServerAnswer(answered)
    await webServiceRequest('GET', '/v1/accounts/me/admin/bug-reports?status=open&limit=1&offset=0')
    expect(answered).toHaveBeenCalledTimes(1)
    status = 502
    const refused = await webServiceRequest('GET', '/v1/accounts/me/admin/bug-reports?status=open&limit=1&offset=0').catch((error: unknown) => error)
    expect(isServerUnavailable(refused)).toBe(true)
    expect(answered).toHaveBeenCalledTimes(1)
    expect(isServerUnavailable(Object.assign(new Error('Не найдено'), { status: 404 }))).toBe(false)
    stop()
  })

  it('«Отчёты»: the table, the owner buttons and the wait for the next change go through, and nothing else of the kind', async () => {
    const fetched = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetched)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, email: 'owner@example.com', kind: 'user' }))
    await webServiceRequest('GET', '/v1/accounts/me/admin/bug-reports/table?view=active&limit=100')
    await webServiceRequest('GET', '/v1/accounts/me/admin/requests/events?since=5')
    await webServiceRequest('POST', '/v1/accounts/me/admin/bug-reports/12/work', { action: 'approve', plan: 'План' })
    await webServiceRequest('POST', '/v1/accounts/me/admin/bug-reports/12/plan', { plan: 'План' })
    expect(fetched).toHaveBeenCalledTimes(4)
    await expect(webServiceRequest('GET', '/v1/accounts/me/admin/bug-reports/table?view=everything&limit=100')).rejects.toThrow()
    await expect(webServiceRequest('POST', '/v1/accounts/me/admin/bug-reports/12/delete', {})).rejects.toThrow()
    expect(fetched).toHaveBeenCalledTimes(4)
  })
})
