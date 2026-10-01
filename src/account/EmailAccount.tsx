import { useState, type FormEvent } from 'react'
import { Check, KeyRound, LoaderCircle, LogIn, Mail, MailCheck, RefreshCw } from 'lucide-react'
import type { ServerAccountStatus } from '../electron'
import { uiText } from '../i18n/renderText'
import { emailSignInToServer, refreshServerStatus } from '../sync/serverSync'
import { postService as post, useAuthFlag, useCooldown, waitFrom, type CodeChallenge } from './codeRequest'
import { CodeInput, Warning } from './PhoneAccount'
import './account.css'

/**
 * E-mail one-time codes in the apps (server/src/routes/email.ts): sign-in by a code from the e-mail, «Забыли пароль?»
 * by e-mail, and «Подтвердите e-mail» in «Личный кабинет». Registration itself happens on the website (the apps open
 * /register), where the code step lives. Everything is hidden while the server has no e-mail provider
 * (GET /v1/accounts/auth-config → emailEnabled: false).
 */

/** null while unknown; false without a server, on an older server or with e-mail codes switched off. */
// eslint-disable-next-line react-refresh/only-export-components
export function useEmailEnabled(online: boolean | undefined) {
  return useAuthFlag('emailEnabled', online)
}

const CODE_LABEL = 'Код из письма'

/**
 * Sign-in by e-mail code (`login`) or password reset (`reset`): e-mail → code (→ new password). The server answers the
 * same for every address, so the form never says whether an address is registered.
 */
export function EmailSignInForm({ purpose, onSignedIn, onBack }: { purpose: 'login' | 'reset'; onSignedIn: (status: ServerAccountStatus) => void; onBack: () => void }) {
  const [email, setEmail] = useState('')
  const [challenge, setChallenge] = useState<CodeChallenge | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cooldown = useCooldown()

  const request = async (event?: FormEvent) => {
    event?.preventDefault()
    setBusy(true); setError('')
    try {
      const next = await post(`/v1/accounts/email/${purpose}/start`, { email: email.trim() }) as CodeChallenge
      setChallenge(next); setCode('')
      cooldown.start(next.resendSeconds)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      if (waitFrom(message)) cooldown.start(waitFrom(message))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (event: FormEvent) => {
    event.preventDefault()
    if (!challenge) return
    if (purpose === 'reset' && password.length < 8) { setError('Новый пароль: от 8 до 128 символов'); return }
    if (purpose === 'reset' && password !== repeat) { setError('Пароли не совпадают'); return }
    setBusy(true); setError('')
    try {
      const status = await emailSignInToServer(purpose, challenge.challengeId, code, purpose === 'reset' ? password : undefined)
      setPassword(''); setRepeat('')
      onSignedIn(status)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  if (!challenge) {
    return (
      <form className="stack" onSubmit={(event) => void request(event)}>
        <p className="muted" style={{ margin: 0 }}>{uiText(purpose === 'login'
          ? 'Введите e-mail аккаунта. Мы пришлём на него код для входа — пароль не нужен.'
          : 'Введите e-mail аккаунта. Мы пришлём на него код, после него задайте новый пароль.')}</p>
        <label className="field-label">{uiText('E-mail')}
          <input className="input" type="email" autoComplete="username" value={email} maxLength={254} placeholder="you@example.com" onChange={(event) => setEmail(event.target.value)} autoFocus />
        </label>
        <Warning text={error} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="button primary" type="submit" disabled={busy || cooldown.left > 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}>
            {busy ? <LoaderCircle className="spin" size={14} /> : <Mail size={14} />}{uiText('Получить код')}
          </button>
          <button className="button ghost" type="button" onClick={onBack}><LogIn size={14} />{uiText('Войти по e-mail и паролю')}</button>
        </div>
      </form>
    )
  }

  return (
    <form className="stack" onSubmit={(event) => void confirm(event)}>
      <p className="muted" style={{ margin: 0 }}>{uiText('Если такой аккаунт есть, на этот e-mail придёт письмо с кодом. Проверьте папку «Спам». Никому не сообщайте код.')}</p>
      <CodeInput value={code} onChange={setCode} label={CODE_LABEL} />
      {purpose === 'reset' && <>
        <label className="field-label">{uiText('Новый пароль')}
          <input className="input" type="password" autoComplete="new-password" value={password} minLength={8} maxLength={128} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label className="field-label">{uiText('Повторите пароль')}
          <input className="input" type="password" autoComplete="new-password" value={repeat} minLength={8} maxLength={128} onChange={(event) => setRepeat(event.target.value)} />
        </label>
        <small className="dim">{uiText('Все входы на других устройствах будут завершены.')}</small>
      </>}
      <Warning text={error} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="button primary" type="submit" disabled={busy || code.length !== 6}>
          {busy ? <LoaderCircle className="spin" size={14} /> : purpose === 'login' ? <LogIn size={14} /> : <KeyRound size={14} />}{uiText(purpose === 'login' ? 'Войти' : 'Сохранить новый пароль')}
        </button>
        <button className="button ghost" type="button" disabled={busy || cooldown.left > 0} onClick={() => void request()}>
          <RefreshCw size={14} />{uiText('Отправить код ещё раз')}{cooldown.left > 0 ? ` (${cooldown.left})` : ''}
        </button>
        <button className="button ghost" type="button" onClick={() => { setChallenge(null); setError('') }}>{uiText('Другой e-mail')}</button>
      </div>
    </form>
  )
}

/** «Войти по коду из письма» / «Забыли пароль?» under a password sign-in form (only with e-mail codes switched on). */
export function EmailSignInLinks({ online, onPick }: { online: boolean | undefined; onPick: (purpose: 'login' | 'reset') => void }) {
  const enabled = useEmailEnabled(online)
  if (!enabled) return null
  return (
    <div className="account-gate-links">
      <button type="button" className="link-button" onClick={() => onPick('login')}><Mail size={14} />{uiText('Войти по коду из письма')}</button>
      <button type="button" className="link-button" onClick={() => onPick('reset')}><KeyRound size={14} />{uiText('Забыли пароль?')}</button>
    </div>
  )
}

/**
 * «Подтвердите e-mail» in «Личный кабинет»: shown only while the account's e-mail is not confirmed and the server sends
 * e-mail codes. Nothing is blocked for unconfirmed accounts yet; confirming enables owner rights for owner e-mails.
 */
export function EmailVerifyRow({ status, online }: { status: ServerAccountStatus; online: boolean }) {
  const enabled = useEmailEnabled(online)
  const [challenge, setChallenge] = useState<CodeChallenge | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const cooldown = useCooldown()

  if (done) return <div className="account-cabinet-cell is-good account-email-verify"><span>{uiText('E-mail')}</span><strong><MailCheck size={14} /> {uiText('E-mail подтверждён')}</strong></div>
  if (!enabled || status.emailVerified !== false || !online) return null

  const run = (task: () => Promise<void>) => {
    setBusy(true); setError('')
    void task().catch((reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      if (waitFrom(message)) cooldown.start(waitFrom(message))
    }).finally(() => setBusy(false))
  }
  const start = () => run(async () => {
    const next = await post('/v1/accounts/me/email/start', {}) as CodeChallenge
    setChallenge(next); setCode('')
    cooldown.start(next.resendSeconds)
  })
  const confirm = () => run(async () => {
    if (!challenge) return
    await post('/v1/accounts/me/email/confirm', { challengeId: challenge.challengeId, code })
    setDone(true)
    void refreshServerStatus()
  })

  return (
    <div className="account-cabinet-cell is-warn account-email-verify">
      <span>{uiText('Подтвердите e-mail')}</span>
      <strong>{status.email ?? '—'}</strong>
      <small>{uiText('Мы пришлём на этот адрес код из 6 цифр. Подтверждённый e-mail нужен, чтобы восстановить доступ к аккаунту.')}</small>
      {!challenge && (
        <span className="account-phone-actions">
          <button className="button primary" disabled={busy || cooldown.left > 0} onClick={start}>{busy ? <LoaderCircle className="spin" size={14} /> : <Mail size={14} />}{uiText('Отправить код')}{cooldown.left > 0 ? ` (${cooldown.left})` : ''}</button>
        </span>
      )}
      {challenge && (
        <form className="stack" onSubmit={(event) => { event.preventDefault(); confirm() }}>
          <CodeInput value={code} onChange={setCode} label={CODE_LABEL} />
          <span className="account-phone-actions">
            <button className="button primary" type="submit" disabled={busy || code.length !== 6}>{busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{uiText('Подтвердить')}</button>
            <button className="button ghost" type="button" disabled={busy || cooldown.left > 0} onClick={start}><RefreshCw size={14} />{uiText('Отправить код ещё раз')}{cooldown.left > 0 ? ` (${cooldown.left})` : ''}</button>
          </span>
        </form>
      )}
      <Warning text={error} />
    </div>
  )
}
