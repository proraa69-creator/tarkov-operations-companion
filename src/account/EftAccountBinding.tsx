import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ShieldAlert } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { cleanIpcError, useServerAccount } from '../sync/serverSync'
import { detectedEftAccount, EFT_IN_USE_TEXT, subscribeEftAccount } from './eftAccountBinding'
import './paywall.css'

/**
 * Desktop only (App): binds the game account seen in the logs to the signed-in server account once per account pair,
 * and shows a notice when the server answers that another Raid OS account already holds it (eftAccountBinding.ts).
 */
export function EftAccountBinding() {
  const { status } = useServerAccount()
  const accountId = useSyncExternalStore(subscribeEftAccount, detectedEftAccount, () => undefined)
  const [refused, setRefused] = useState('')
  const [dismissed, setDismissed] = useState('')
  const sent = useRef('')
  const email = status?.signedIn && status.online ? status.email : undefined

  useEffect(() => {
    const request = window.tarkovDesktop?.serviceRequest
    if (!request || !email || accountId === undefined) return
    const key = `${email}:${accountId}`
    if (sent.current === key) return
    sent.current = key
    request('POST', '/v1/accounts/me/eft-account', { accountId: String(accountId) })
      .then(() => setRefused((current) => (current === key ? '' : current)))
      .catch((error: unknown) => {
        if (/уже используется/i.test(cleanIpcError(error))) setRefused(key)
        // Offline or a server without the route yet: try again with the next sign-in or game account.
        else sent.current = ''
      })
  }, [email, accountId])

  if (!refused || dismissed === refused || !email || refused !== `${email}:${accountId}`) return null
  return (
    <div className="paywall-device-notice" role="alert">
      <ShieldAlert size={16} />
      <span>{uiText(EFT_IN_USE_TEXT)} {uiText('Войдите в тот аккаунт или напишите в поддержку.')}</span>
      <button type="button" className="button ghost" onClick={() => setDismissed(refused)}>{uiText('Понятно')}</button>
    </div>
  )
}
