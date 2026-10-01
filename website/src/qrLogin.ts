/**
 * QR sign-in on the website (server/src/services/loginCodes.ts). Separate from api.ts on purpose: these calls return
 * a new session only once, for this browser, after a signed-in phone or desktop app approved the code.
 *
 *   POST /v1/accounts/qr-login                 -> { requestId, pollSecret, code, expiresAt }
 *   POST /v1/accounts/qr-login/poll            { requestId, pollSecret } -> 202 | 200 { token, account } | 410
 *   POST /v1/accounts/login-codes/redeem       { code } -> { token, account }    (code from the desktop app's QR)
 *   POST /v1/accounts/me/qr-login/inspect      Bearer { code } -> { createdAt, agent, ip?, country? }
 *   POST /v1/accounts/me/qr-login/approve      Bearer { code } -> { ok }
 */
import { ApiError, fallbackMessage, NETWORK_ERROR_MESSAGE, type Account } from './api'
import { API_URL } from './config'

export interface QrLoginRequest { requestId: string; pollSecret: string; code: string; expiresAt: string }
/** Who asks to sign in: the browser, when, and roughly where from (masked network «203.0.113.x», Cloudflare's country). */
export interface QrRequester { createdAt: string; expiresAt?: string; agent: string; ip?: string; country?: string }
export type QrPoll = { status: 'pending' } | { status: 'expired' } | { status: 'done'; token: string; account: Account }

async function post(path: string, body: unknown, token?: string | null): Promise<{ status: number; data: unknown }> {
  let response: Response
  try {
    response = await fetch(`${API_URL}/v1/accounts${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    throw new ApiError(0, NETWORK_ERROR_MESSAGE, true)
  }
  let data: unknown
  try { data = await response.json() } catch { data = undefined }
  if (!response.ok && response.status !== 410) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : fallbackMessage(response.status)
    throw new ApiError(response.status, message)
  }
  return { status: response.status, data }
}

export const qrLogin = {
  async start(): Promise<QrLoginRequest> {
    return (await post('/qr-login', {})).data as QrLoginRequest
  },
  async poll(request: QrLoginRequest): Promise<QrPoll> {
    const { status, data } = await post('/qr-login/poll', { requestId: request.requestId, pollSecret: request.pollSecret })
    if (status === 202) return { status: 'pending' }
    if (status === 410) return { status: 'expired' }
    const answer = data as { token?: unknown; account?: Account }
    if (typeof answer.token !== 'string' || !answer.account) throw new ApiError(status, 'Сервер вернул неожиданный ответ')
    return { status: 'done', token: answer.token, account: answer.account }
  },
  async redeem(code: string): Promise<{ token: string; account: Account }> {
    const { data } = await post('/login-codes/redeem', { code })
    return data as { token: string; account: Account }
  },
  async inspect(token: string, code: string) {
    return (await post('/me/qr-login/inspect', { code }, token)).data as QrRequester
  },
  async approve(token: string, code: string) {
    await post('/me/qr-login/approve', { code }, token)
  },
}

/** The API address the phone app should use: this site itself when the API is served under it (VITE_API_URL='/'). */
export function siteServerUrl() {
  try { return new URL(API_URL || '/', window.location.href).origin } catch { return window.location.origin }
}

/** Link that opens the phone app (docs/mobile.md): Android gets an intent with the website as fallback. */
export function appDeepLink(action: 'login' | 'approve', code: string, fallback: string) {
  const query = new URLSearchParams({ code, server: siteServerUrl() }).toString()
  if (/Android/i.test(navigator.userAgent)) {
    return `intent://${action}?${query}#Intent;scheme=tarkovoperator;package=com.tarkovoperator.app;S.browser_fallback_url=${encodeURIComponent(fallback)};end`
  }
  return `tarkovoperator://${action}?${query}`
}

/** «Chrome · Windows» from a user agent, so a person sees what asks to sign in. */
export function describeAgent(agent: string) {
  const browser = /Edg\//.test(agent) ? 'Edge' : /OPR\//.test(agent) ? 'Opera' : /YaBrowser\//.test(agent) ? 'Яндекс Браузер' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Браузер'
  const system = /Windows/.test(agent) ? 'Windows' : /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Mac OS X/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : ''
  return system ? `${browser} · ${system}` : browser
}

/** «Нидерланды · IP 203.0.113.x» — where the sign-in request came from, approximately; '' when unknown. */
export function describePlace(info: { ip?: string; country?: string }) {
  let country = info.country ?? ''
  if (country) { try { country = new Intl.DisplayNames(['ru'], { type: 'region' }).of(country) ?? country } catch { /* keep the code */ } }
  return [country, info.ip ? `IP ${info.ip}` : ''].filter(Boolean).join(' · ')
}

/** «k7qx m2pd» → «K7QXM2PD»: compares a typed code with the one in the link. */
export const normalizeLoginCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, '')
