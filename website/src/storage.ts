import { AD_ATTRIBUTION_MS, normalizeAdMark, type AdMark } from '../../src/shared/adSources'

// Browser storage can be unavailable (private mode, blocked site data), so every access is guarded.
const SESSION_KEY = 'toc.session'
const REFERRAL_KEY = 'toc.referral'

function read(key: string) {
  try { return window.localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch { /* storage unavailable: the value just is not remembered */ }
}

export const REFERRAL_CODE_PATTERN = /^[A-Z0-9_-]{3,24}$/

export function normalizeReferralCode(code: string) {
  return code.trim().toUpperCase()
}

export const loadSessionToken = () => read(SESSION_KEY)
export const saveSessionToken = (token: string | null) => write(SESSION_KEY, token)

export function loadReferralCode() {
  const code = read(REFERRAL_KEY)
  return code && REFERRAL_CODE_PATTERN.test(code) ? code : null
}
export const saveReferralCode = (code: string | null) => write(REFERRAL_KEY, code)

/**
 * «Реклама»: the label of the ad's link the site was opened with (adVisit.ts), sent with the registration for
 * AD_ATTRIBUTION_MS (src/shared/adSources.ts); `at` is when the link was opened.
 */
const AD_KEY = 'toc.ad'
export function loadAdMark(now = Date.now()): AdMark | undefined {
  try {
    const saved = JSON.parse(read(AD_KEY) ?? 'null') as { source?: unknown; campaign?: unknown; at?: unknown } | null
    if (!saved || typeof saved.at !== 'number' || now - saved.at > AD_ATTRIBUTION_MS || saved.at > now + 60_000) return undefined
    return normalizeAdMark(saved.source, saved.campaign)
  } catch { return undefined }
}
export function saveAdMark(mark: AdMark | null, now = Date.now()) {
  write(AD_KEY, mark ? JSON.stringify({ ...mark, at: now }) : null)
}

/** A squad code from an opened /squad/<code> link, kept for this tab until the person signs in (cabinet «Отряд»). */
const PENDING_SQUAD_KEY = 'raidos-pending-squad-code'
export function readPendingSquadCode() {
  try { return window.sessionStorage.getItem(PENDING_SQUAD_KEY) ?? '' } catch { return '' }
}
export function savePendingSquadCode(code: string | null) {
  try {
    if (code) window.sessionStorage.setItem(PENDING_SQUAD_KEY, code)
    else window.sessionStorage.removeItem(PENDING_SQUAD_KEY)
  } catch { /* storage unavailable */ }
}
