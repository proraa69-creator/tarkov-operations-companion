import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ShieldAlert } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { cleanIpcError, refreshServerStatus, useServerAccount } from '../sync/serverSync'
import { detectedEftAccounts, EFT_IN_USE_TEXT, EFT_OTHER_TEXT, reportEftAccounts, subscribeEftAccount } from './eftAccountLink'
import './paywall.css'

/**
 * Desktop only (App): reports the game account seen in the logs to the signed-in server account once per account pair
 * (eftAccountLink.ts). Whatever the answer, the account status is asked for again at once: when the server refuses this
 * PC (one game account — one Raid OS account) the app locks with the reason (Paywall.tsx EftLock). The notice below is
 * only for a refusal that did not lock the app (a session without a registered device).
 */
const NONE: readonly number[] = []

export function EftAccountBinding() {
  const { status } = useServerAccount()
  const accounts = useSyncExternalStore(subscribeEftAccount, detectedEftAccounts, () => NONE)
  const accountId = accounts.join(',')
  const [refused, setRefused] = useState<{ key: string; text: string } | null>(null)
  const [dismissed, setDismissed] = useState('')
  const sent = useRef('')
  const email = status?.signedIn && status.online ? status.email : undefined

  useEffect(() => {
    const request = window.tarkovDesktop?.serviceRequest
    if (!request || !email || !accounts.length) return
    const key = `${email}:${accountId}`
    if (sent.current === key) return
    sent.current = key
    // every game account of the logs in turn, the newest first, until the server takes one (eftAccountLink.ts)
    void reportEftAccounts(request, accounts, cleanIpcError).then((result) => {
      if ('taken' in result) setRefused((current) => (current?.key === key ? null : current))
      else if ('refused' in result) setRefused({ key, text: /уже используется/i.test(result.refused) ? EFT_IN_USE_TEXT : EFT_OTHER_TEXT })
      // Offline or a server without the route yet: try again with the next sign-in or game account.
      else { sent.current = ''; return }
      void refreshServerStatus()
    })
  }, [email, accountId, accounts])

  if (!refused || dismissed === refused.key || !email || refused.key !== `${email}:${accountId}`) return null
  return (
    <div className="paywall-device-notice" role="alert">
      <ShieldAlert size={16} />
      <span>{uiText(refused.text)} {uiText('Войдите в тот аккаунт или напишите в поддержку.')}</span>
      <button type="button" className="button ghost" onClick={() => setDismissed(refused.key)}>{uiText('Понятно')}</button>
    </div>
  )
}
