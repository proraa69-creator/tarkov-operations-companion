import type { CountryChoice } from '../components/CountryPicker'
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
