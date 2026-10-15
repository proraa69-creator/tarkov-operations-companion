import { CountryGate } from '../account/CountryGate'

/**
 * What the server asks of the signed-in account, over the whole app (src/app/App.tsx), one window at a time:
 * «Укажите страну» while the account has no country (account/CountryGate.tsx).
 */
export function AccountNotices() {
  return <CountryGate />
}
