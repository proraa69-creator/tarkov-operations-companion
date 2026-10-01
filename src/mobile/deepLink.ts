/**
 * QR sign-in links the phone app handles (docs/mobile.md). The camera opens the website page `/app-login`, which hands
 * the data to the app through the custom scheme:
 *   tarkovoperator://login?code=<one-time code>&server=<https address>    sign in (from «Войти в мобильную версию»)
 *   tarkovoperator://approve?code=<XXXX-XXXX>&server=<https address>      approve a website sign-in («Войти по QR-коду»)
 * `raidos://` (the new name, «Raid OS») works the same; the site keeps sending tarkovoperator:// so phones with an
 * older app version still open. Anything else is ignored. The code is short-lived and works once; the session token itself is never in a link.
 */
export type AccountDeepLink =
  | { kind: 'login'; code: string; server: string }
  | { kind: 'approve'; code: string; server: string }

export const APP_SCHEME = 'tarkovoperator'
export const APP_SCHEMES = [APP_SCHEME, 'raidos']

export function parseAccountDeepLink(raw: string): AccountDeepLink | null {
  let url: URL
  try { url = new URL(raw) } catch { return null }
  if (!APP_SCHEMES.some((scheme) => url.protocol === `${scheme}:`)) return null
  // tarkovoperator://login?… → host «login»; tarkovoperator:login?… → pathname «login».
  const action = (url.hostname || url.pathname.replace(/^\/+/, '')).toLowerCase()
  const code = url.searchParams.get('code')?.trim() ?? ''
  const server = url.searchParams.get('server')?.trim() ?? ''
  if (action === 'login' && /^[A-Za-z0-9_-]{43}$/.test(code)) return { kind: 'login', code, server }
  if (action === 'approve' && /^[A-Za-z2-9]{4}-?[A-Za-z2-9]{4}$/.test(code)) return { kind: 'approve', code: code.toUpperCase(), server }
  return null
}
