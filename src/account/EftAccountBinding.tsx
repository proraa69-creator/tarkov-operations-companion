import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ShieldAlert } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { cleanIpcError, refreshServerStatus, useServerAccount } from '../sync/serverSync'
import { detectedEftAccount, EFT_IN_USE_TEXT, EFT_OTHER_TEXT, EFT_REPORT_PATH, subscribeEftAccount } from './eftAccountLink'
import './paywall.css'

/**
 * Desktop only (App): reports the game account seen in the logs to the signed-in server account once per account pair
 * (eftAccountLink.ts). Whatever the answer, the account status is asked for again at once: when the server refuses this
 * PC (one game account — one Raid OS account) the app locks with the reason (Paywall.tsx EftLock). The notice below is
 * only for a refusal that did not lock the app (a session without a registered device).
 */
export function EftAccountBinding() {
  const { status } = useServerAccount()
  const accountId = useSyncExternalStore(subscribeEftAccount, detectedEftAccount, () => undefined)
  const [refused, setRefused] = useState<{ key: string; text: string } | null>(null)
  const [dismissed, setDismissed] = useState('')
  const sent = useRef('')
  const email = status?.signedIn && status.online ? status.email : undefined

  useEffect(() => {
    const request = window.tarkovDesktop?.serviceRequest
    if (!request || !email || accountId === undefined) return
    const key = `${email}:${accountId}`
    if (sent.current === key) return
    sent.current = key
    request('POST', EFT_REPORT_PATH, { accountId: String(accountId) })
      .then(() => { setRefused((current) => (current?.key === key ? null : current)); void refreshServerStatus() })
      .catch((error: unknown) => {
        const message = cleanIpcError(error)
        if (/уже используется/i.test(message)) setRefused({ key, text: EFT_IN_USE_TEXT })
        else if (/привязан другой аккаунт/i.test(message)) setRefused({ key, text: EFT_OTHER_TEXT })
        // Offline or a server without the route yet: try again with the next sign-in or game account.
        else { sent.current = ''; return }
        void refreshServerStatus()
      })
  }, [email, accountId])

  if (!refused || dismissed === refused.key || !email || refused.key !== `${email}:${accountId}`) return null
  return (
    <div className="paywall-device-notice" role="alert">
      <ShieldAlert size={16} />
      <span>{uiText(refused.text)} {uiText('Войдите в тот аккаунт или напишите в поддержку.')}</span>
      <button type="button" className="button ghost" onClick={() => setDismissed(refused.key)}>{uiText('Понятно')}</button>
    </div>
  )
}
