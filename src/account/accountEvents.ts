/** Opens the account window again (after «Продолжить без входа»), see AccountController; `tab` picks «Регистрация». */
export const OPEN_ACCOUNT_SIGN_IN_EVENT = 'tarkov-open-account-sign-in'

export function openAccountSignIn(tab: 'login' | 'register' = 'login') {
  window.dispatchEvent(new CustomEvent(OPEN_ACCOUNT_SIGN_IN_EVENT, { detail: tab }))
}
