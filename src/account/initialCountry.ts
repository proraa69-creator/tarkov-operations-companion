import { useEffect, useState } from 'react'
import type { CountryChoice } from '../components/CountryPicker'
import { useServerStatus } from '../sync/serverSync'
import { serviceClient } from './nicknameBinding'

/** The server's account view says the account has no country yet (servers before 15.10.2026 never say so). */
export function needsCountry(view: unknown) {
  return Boolean(view && typeof view === 'object' && (view as { needsCountry?: unknown }).needsCountry === true)
}

/** Sets the country of an account that has none (server/src/services/accountStore.ts setInitialCountry). */
export async function saveInitialCountry(choice: CountryChoice) {
  const request = serviceClient()
  if (!request) throw new Error('Сервер недоступен')
  const view = await request('POST', '/v1/accounts/me/initial-country', choice)
  if (!view) throw new Error('Сервер недоступен')
  return view
}

/** The signed-in account ('' when nobody is, or the server is not reachable) and whether it still needs a country. */
export function useCountryGate() {
  const status = useServerStatus()
  const account = status?.signedIn && status.online ? status.email ?? 'signed-in' : ''
  // The account the server said has no country; the window is for that account only (another sign-in asks again).
  const [missingFor, setMissingFor] = useState('')
  useEffect(() => {
    if (!account) return
    const request = serviceClient()
    if (!request) return
    let alive = true
    void request('GET', '/v1/accounts/me').then((view) => { if (alive) setMissingFor(needsCountry(view) ? account : '') }).catch(() => {})
    return () => { alive = false }
  }, [account])
  return { account, missing: Boolean(account) && missingFor === account, saved: () => setMissingFor('') }
}
