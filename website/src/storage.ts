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
