/** POST /v1/accounts/me/qr-login/inspect: the browser, when, and roughly where from (masked network, country). */
export interface Inspected { createdAt: string; agent: string; ip?: string; country?: string }

/** Short description of the browser that asks to sign in («Chrome · Windows»). */
export function describeAgent(agent: string) {
  const browser = /Edg\//.test(agent) ? 'Edge' : /OPR\//.test(agent) ? 'Opera' : /YaBrowser\//.test(agent) ? 'Яндекс Браузер' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Браузер'
  const system = /Windows/.test(agent) ? 'Windows' : /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Mac OS X/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : ''
  return system ? `${browser} · ${system}` : browser
}

/** «Netherlands · IP 203.0.113.x» in the interface language; '' when the server did not know. */
export function describePlace(info: Inspected, locale: string) {
  let country = info.country ?? ''
  if (country) { try { country = new Intl.DisplayNames([locale], { type: 'region' }).of(country) ?? country } catch { /* keep the code */ } }
  return [country, info.ip ? `IP ${info.ip}` : ''].filter(Boolean).join(' · ')
}

/** «k7qx m2pd» → «K7QXM2PD»: what the person typed, compared with the code from the link. */
export function normalizeLoginCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}
