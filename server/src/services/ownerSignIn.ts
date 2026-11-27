/**
 * The owner's sign-ins (owner, 27.11.2026: «второй фактор для входа владельца… После каждого входа владельцу приходит
 * уведомление»): how a session came (SignInMethod), where from (SignInOrigin: the request's address, Cloudflare's country,
 * the browser or the app), and the lines the owner's notice and the owner's audit log show of it. Never a code, a token or a
 * password; the whole User-Agent stays out of the e-mail.
 */
import { countryName } from '../../../src/shared/countries'
import { ownerText } from '../../../src/shared/ownerTime'

/**
 * How a session was made: the password alone (the server sends no e-mail: no second factor), the password and the code
 * from the e-mail, a code from the e-mail alone (players; the owner's addresses get none), a new password by an e-mail
 * code, or a QR code approved on a signed-in device.
 */
export type SignInMethod = 'password' | 'password-code' | 'email-code' | 'email-reset' | 'qr'

export interface SignInOrigin {
  /** req.ip: the visitor behind the loopback proxy (app.ts `trust proxy`). */
  ip?: string
  /** The User-Agent header. */
  agent?: string
  /** Two letters (Cloudflare's CF-IPCountry, else RU for a Russian address), when known. */
  country?: string
}

/** Told of every sign-in that made a session (app.ts: for the owner's account, the owner's notice and the audit log). */
export type SignInListener = (accountId: string, method: SignInMethod, origin: SignInOrigin) => void

/** The origin of a framework-free request (routes put `agent` and `country` next to `ip`). */
export const originOf = (req: { ip?: string; agent?: string; country?: string }): SignInOrigin => ({ ip: req.ip, agent: req.agent, country: req.country })

const METHOD_TEXT: Record<SignInMethod, string> = {
  password: 'пароль',
  'password-code': 'пароль и код из письма',
  'email-code': 'код из письма',
  'email-reset': 'новый пароль по коду из письма',
  qr: 'QR-код с другого устройства',
}

/** No control characters, one line, at most `max` characters. */
// eslint-disable-next-line no-control-regex
const oneLine = (text: string, max: number) => text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** «203.0.113.7» / «2001:db8::1» (a v4 address mapped into v6 loses its prefix); undefined for anything else. */
export function plainAddress(raw: string | undefined) {
  const value = (raw ?? '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '').replace(/%.*$/, '')
  return /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]{2,39})$/i.test(value) ? value : undefined
}

/**
 * The browser or the app, in short: «Chrome · Windows», «Raid OS для Windows 0.6.0.354», «приложение на Android».
 * The PC app names itself (electron/serviceGateway.ts DESKTOP_AGENT); the phone app is the system's own web view
 * («; wv)» on Android, no «Safari/» on an iPhone). Anything else shows the start of its User-Agent («curl/8.5.0»).
 */
export function describeAgent(raw: string | undefined) {
  const agent = oneLine(raw ?? '', 400)
  if (!agent) return 'неизвестно'
  const desktop = /^RaidOS-Desktop(?:\/([0-9A-Za-z.+-]{1,32}))?(?:\s|$)/.exec(agent)
  if (desktop) return desktop[1] ? `Raid OS для Windows ${desktop[1]}` : 'Raid OS для Windows'
  if (/Electron\//.test(agent)) return 'Raid OS для Windows'
  const system = /Windows/.test(agent) ? 'Windows' : /Android/.test(agent) ? 'Android' : /iPhone|iPad|iPod/.test(agent) ? 'iOS' : /Mac OS X|Macintosh/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : ''
  if (system === 'Android' && /; wv\)/.test(agent)) return 'приложение на Android'
  if (system === 'iOS' && /AppleWebKit\//.test(agent) && !/Safari\//.test(agent)) return 'приложение на iPhone'
  const browser = /Edg(?:A|iOS)?\//.test(agent) ? 'Edge' : /OPR\//.test(agent) ? 'Opera' : /YaBrowser\//.test(agent) ? 'Яндекс Браузер'
    : /Firefox\/|FxiOS\//.test(agent) ? 'Firefox' : /Chrome\/|CriOS\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : ''
  if (!browser) return agent.slice(0, 80)
  return system ? `${browser} · ${system}` : browser
}

/** «Таиланд (TH)»; undefined without a known two-letter country. */
function countryText(raw: string | undefined) {
  const code = (raw ?? '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX') return undefined
  const name = countryName(code, 'ru')
  return name && name !== code ? `${name} (${code})` : code
}

/** The lines of the owner's notice: when (Bangkok time), the address, the country when known, the device and the way. */
export function signInFacts(method: SignInMethod, origin: SignInOrigin, at: number): Array<[string, string]> {
  const country = countryText(origin.country)
  return [
    ['Время', `${ownerText(at)} (Бангкок)`],
    ['IP', plainAddress(origin.ip) ?? 'неизвестен'],
    ...(country ? [['Страна', country] as [string, string]] : []),
    ['Устройство', describeAgent(origin.agent)],
    ['Способ входа', METHOD_TEXT[method]],
  ]
}

/** What the audit log keeps of a sign-in (owner_audit_log `owner.sign-in`): the same, the User-Agent cut to 200 characters. */
export function signInAudit(method: SignInMethod, origin: SignInOrigin): Record<string, string> {
  const ip = plainAddress(origin.ip)
  const country = countryText(origin.country)
  const agent = oneLine(origin.agent ?? '', 200)
  return { method, ...(ip ? { ip } : {}), ...(country ? { country } : {}), device: describeAgent(origin.agent), ...(agent ? { agent } : {}) }
}
