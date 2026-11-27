import { useState, type FormEvent } from 'react'
import { LoaderCircle, LogIn, Mail, RefreshCw } from 'lucide-react'
import type { PendingSecondFactor, ServerAccountStatus } from '../electron'
import { uiText } from '../i18n/renderText'
import { confirmLoginOnServer } from '../sync/serverSync'
import { CodeInput, Warning } from './codeFields'
import { postService, useCooldown, waitFrom, type CodeChallenge } from './codeRequest'
import './account.css'

/**
 * The owner's sign-in, step 2 (owner, 27.11.2026: «После верного пароля на почту владельца приходит код, без кода входа
 * нет»): the server took his password and e-mailed a code; only that code signs the app in (POST /v1/accounts/login/confirm,
 * through the main process on the PC — the session never reaches this page — or sync/webAccount.ts on the phone). The
 * same step in the account window (AccountSignIn.tsx) and in «Аккаунт сервера» (components/ServerAccountPanel.tsx).
 */
export function SecondFactorStep({ pending, email, onSigningIn, onSignedIn, onBack }: {
  pending: PendingSecondFactor
  email: string
  /** Right before the request that signs in (the account window keeps itself open until it settles). */
  onSigningIn?: () => void
  onSignedIn: (status: ServerAccountStatus) => void
  /** «Назад»: the e-mail and password again. */
  onBack: () => void
}) {
  const [challenge, setChallenge] = useState(pending)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cooldown = useCooldown(pending.resendSeconds)

  const fail = (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    setError(message)
    if (waitFrom(message)) cooldown.start(waitFrom(message))
  }

  const confirm = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    onSigningIn?.()
    try {
      onSignedIn(await confirmLoginOnServer(challenge.challengeId, code))
    } catch (reason) {
      fail(reason)
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const next = await postService('/v1/accounts/login/resend', { challengeId: challenge.challengeId }) as CodeChallenge
      setChallenge({ ...challenge, ...next })
      setCode('')
      cooldown.start(next.resendSeconds)
    } catch (reason) {
      fail(reason)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack account-gate-form" onSubmit={(event) => void confirm(event)}>
      <div className="account-gate-pending" role="status"><Mail size={18} /><span>{uiText(challenge.message)}<small>{email}</small></span></div>
      <p className="muted">{uiText('Код из 6 цифр действует 10 минут. Не пришло письмо — проверьте папку «Спам».')}</p>
      <CodeInput value={code} onChange={setCode} />
      <Warning text={error} />
      <button className="button primary account-gate-submit" type="submit" disabled={busy || code.length !== 6}>
        {busy ? <LoaderCircle className="spin" size={16} /> : <LogIn size={16} />}{uiText('Войти')}
      </button>
      <div className="account-gate-links">
        <button type="button" className="link-button" disabled={busy || cooldown.left > 0} onClick={() => void resend()}><RefreshCw size={14} />{uiText('Отправить код ещё раз')}{cooldown.left > 0 ? ` (${cooldown.left})` : ''}</button>
        <button type="button" className="link-button" onClick={onBack}>{uiText('Назад')}</button>
      </div>
    </form>
  )
}
