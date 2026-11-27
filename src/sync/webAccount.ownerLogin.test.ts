import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webAccountLogin, webAccountLoginConfirm, webAdminAccountLogin, webAdminAccountLoginConfirm, webServiceRequest, webStoredSessionEmail } from './webAccount'

/**
 * The phone's transport and the owner's second factor (owner, 27.11.2026: «После верного пароля на почту владельца
 * приходит код, без кода входа нет»): POST /v1/accounts/login answers 202 { secondFactor } for the owner's account; the
 * phone keeps nothing until POST /v1/accounts/login/confirm with the code from the e-mail. Only «Отправить код ещё раз»
 * is on the whitelist; the call that returns a session is the transport's own.
 */
const OWNER = 'owner@example.com'
const token = 'a'.repeat(43)
const CHALLENGE = 'c'.repeat(32)
const PENDING = { secondFactor: true, message: 'Мы отправили код на почту. Введите его, чтобы войти.', challengeId: CHALLENGE, expiresAt: '2026-11-27T10:10:00.000Z', resendSeconds: 60 }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function server(options: { wrongCode?: boolean } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    void init
    const path = new URL(url).pathname
    if (path === '/v1/accounts/login') return json(PENDING, 202)
    if (path === '/v1/accounts/login/confirm') return options.wrongCode ? json({ error: 'Неверный или устаревший код. Проверьте код или запросите новый.' }, 401) : json({ token, account: { email: OWNER, kind: 'user', owner: true } })
    if (path === '/v1/accounts/login/resend') return json({ challengeId: CHALLENGE, expiresAt: '2026-11-27T10:12:00.000Z', resendSeconds: 60 })
    if (path === '/health') return json({ ok: true })
    if (path === '/v1/accounts/me') return json({ email: OWNER, kind: 'user', owner: true, nicknames: {}, subscription: { status: 'inactive' } })
    return json({ error: 'Не найдено' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  const calls = (path: string) => fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === path)
  return { fetchMock, calls }
}

describe('phone transport: the owner\'s code from the e-mail after the password', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  it('the admin app: 202 shows the code step with nothing kept; the code keeps the session', async () => {
    const { calls } = server()
    const first = await webAdminAccountLogin('Owner@Example.com', 'correct horse battery')
    expect(first.signedIn).toBe(false)
    expect(first.secondFactor).toEqual({ challengeId: CHALLENGE, expiresAt: PENDING.expiresAt, resendSeconds: 60, message: PENDING.message })
    expect(webStoredSessionEmail()).toBeNull()
    // «Отправить код ещё раз» goes through the whitelist, without a session; the code itself does not.
    expect(await webServiceRequest('POST', '/v1/accounts/login/resend', { challengeId: CHALLENGE })).toMatchObject({ challengeId: CHALLENGE, resendSeconds: 60 })
    expect((calls('/v1/accounts/login/resend')[0]![1]!.headers as Record<string, string>).authorization).toBeUndefined()
    await expect(webServiceRequest('POST', '/v1/accounts/login/confirm', { challengeId: CHALLENGE, code: '123456' })).rejects.toThrow('Неизвестный запрос сервиса')
    await expect(webAdminAccountLoginConfirm(CHALLENGE, '12345')).rejects.toThrow('Код из письма — 6 цифр')
    await expect(webAdminAccountLoginConfirm('short', '123456')).rejects.toThrow('Запросите код ещё раз')
    const status = await webAdminAccountLoginConfirm(CHALLENGE, '123 456')
    expect(status).toMatchObject({ signedIn: true, email: OWNER, owner: true })
    expect(webStoredSessionEmail()).toBe(OWNER)
    expect(JSON.parse(String(calls('/v1/accounts/login/confirm')[0]![1]!.body))).toEqual({ challengeId: CHALLENGE, code: '123456' })
  })

  it('the players\' app takes the same 202; a wrong code keeps nothing and says the server\'s reason', async () => {
    server({ wrongCode: true })
    const first = await webAccountLogin(OWNER, 'correct horse battery')
    expect(first.secondFactor?.challengeId).toBe(CHALLENGE)
    expect(first.signedIn).toBe(false)
    await expect(webAccountLoginConfirm(CHALLENGE, '000000')).rejects.toThrow('Неверный или устаревший код')
    expect(webStoredSessionEmail()).toBeNull()
  })

  it('a 202 without a usable challenge is refused rather than taken for a sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ secondFactor: true, challengeId: 'bad' }, 202)))
    await expect(webAdminAccountLogin(OWNER, 'correct horse battery')).rejects.toThrow('Сервер вернул неожиданный ответ')
    expect(webStoredSessionEmail()).toBeNull()
  })
})
