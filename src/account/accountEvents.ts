/** Opens the account sign-in window again (after «Продолжить без входа»), see AccountController. */
export const OPEN_ACCOUNT_SIGN_IN_EVENT = 'tarkov-open-account-sign-in'

export function openAccountSignIn() {
  window.dispatchEvent(new Event(OPEN_ACCOUNT_SIGN_IN_EVENT))
}
