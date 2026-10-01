/** Opens the account sign-in window again (after «Продолжить без входа»), see AccountController. */
export const OPEN_ACCOUNT_SIGN_IN_EVENT = 'tarkov-open-account-sign-in'

export function openAccountSignIn() {
  window.dispatchEvent(new Event(OPEN_ACCOUNT_SIGN_IN_EVENT))
}

/**
 * Sign-in happened on the paywall (src/account/Paywall.tsx): once the app opens, AccountController continues with
 * «Привязать ник» unless the account already has nicknames (kept for this window only).
 */
const NICK_STEP_KEY = 'raidos-nick-step-after-sign-in'

export function requestNicknameStep(nicknames?: Partial<Record<string, string>>) {
  const known = nicknames && Object.values(nicknames).some(Boolean)
  try { if (known) sessionStorage.removeItem(NICK_STEP_KEY); else sessionStorage.setItem(NICK_STEP_KEY, '1') } catch { /* storage unavailable */ }
}

export function nicknameStepRequested() {
  try { return sessionStorage.getItem(NICK_STEP_KEY) === '1' } catch { return false }
}

export function clearNicknameStepRequest() {
  try { sessionStorage.removeItem(NICK_STEP_KEY) } catch { /* storage unavailable */ }
}
