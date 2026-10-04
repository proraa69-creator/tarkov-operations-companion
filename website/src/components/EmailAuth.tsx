import { KeyRound, LoaderCircle, LogIn, Mail, MailCheck, RefreshCw } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api, errorMessage, type PendingRegistration, type CodeChallenge } from '../api'
import { useAuth } from '../auth'
import { Notice } from './Notice'
import { useAuthConfig } from './authConfig'

/**
 * E-mail one-time codes on the website (server/src/routes/email.ts): the code step after registration, sign-in by a
 * code from the e-mail, «Забыли пароль?» by e-mail, and «Подтвердите e-mail» in the cabinet. Hidden while the server
 * has no e-mail provider (GET /v1/accounts/auth-config → emailEnabled: false); registration then works without codes.
 */

function useSecondsLeft(until: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= Date.now()) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [until])
  return Math.max(0, Math.ceil((until - now) / 1000))
}

export const retryAfter = (error: unknown) => {
  const match = error instanceof ApiError ? /через (\d+) с/.exec(error.message) : null
  return match ? Date.now() + Number(match[1]) * 1000 : 0
}

export const failure = (error: unknown) => error !== null && <Notice tone={error instanceof ApiError && error.network ? 'offline' : 'error'}>{errorMessage(error)}</Notice>

export function EmailCodeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span className="field-label">Код из письма</span>
      <input className="input code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, '').slice(0, 6))} placeholder="000000" autoFocus />
      <span className="field-hint">6 цифр. Код действует 10 минут, после 5 неверных попыток нужен новый. Письма нет — проверьте папку «Спам».</span>
    </label>
  )
}

export function ResendButton({ until, busy, onClick }: { until: number; busy: boolean; onClick: () => void }) {
  const left = useSecondsLeft(until)
  return (
    <button type="button" className="button ghost small" disabled={busy || left > 0} onClick={onClick}>
      <RefreshCw aria-hidden="true" />{left > 0 ? `Отправить код ещё раз через ${left} с` : 'Отправить код ещё раз'}
    </button>
  )
}

/**
 * Registration, step 2: the code from the e-mail. The server answered the same for every address, so this step never
 * says whether the address was free; a wrong or missing code simply does not create an account.
 */
export function RegistrationCodeStep({ email, pending, onDone, onBack }: { email: string; pending: PendingRegistration; onDone: (result: { token: string; referralApplied: boolean }) => void; onBack: () => void }) {
  const auth = useAuth()
  const [code, setCode] = useState('')
  const [resendAt, setResendAt] = useState(() => Date.now() + pending.resendSeconds * 1000)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [resent, setResent] = useState(false)

  async function confirm(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null)
    try {
      onDone(await auth.confirmRegistration(pending.challengeId, code))
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setBusy(true); setError(null); setResent(false)
    try {
      const next = await api.registerResend(pending.challengeId)
      setResendAt(Date.now() + next.resendSeconds * 1000)
      setCode(''); setResent(true)
    } catch (reason) {
      setError(reason)
      const wait = retryAfter(reason)
      if (wait) setResendAt(wait)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={confirm}>
      <Notice tone="info" title="Мы отправили код на e-mail">Введите код из письма, отправленного на <strong>{email}</strong>, чтобы завершить регистрацию. Аккаунт появится после подтверждения.</Notice>
      {resent && <Notice tone="success">Новый код отправлен. Предыдущий больше не действует.</Notice>}
      {failure(error)}
      <EmailCodeField value={code} onChange={setCode} />
      <button type="submit" className="button primary large block" disabled={busy || code.length !== 6}>
        {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <MailCheck aria-hidden="true" />}Подтвердить и войти
      </button>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <ResendButton until={resendAt} busy={busy} onClick={() => void resend()} />
        <button type="button" className="button ghost small" onClick={onBack}>Изменить e-mail</button>
      </div>
      <p className="field-hint" style={{ margin: 0 }}>Если на этот адрес уже есть аккаунт, новый не создаётся — войдите с паролем или воспользуйтесь «Забыли пароль?».</p>
    </form>
  )
}

/**
 * Sign-in by e-mail code (purpose 'login') or the password reset (purpose 'reset'): e-mail → code (→ new password).
 * The server answers the same for any address, so the page never says whether the address is registered.
 */
export function EmailSignIn({ purpose, onDone, onBack, backLabel = 'Войти по e-mail и паролю' }: { purpose: 'login' | 'reset'; onDone: () => void; onBack?: () => void; backLabel?: string }) {
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [challenge, setChallenge] = useState<CodeChallenge | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [localError, setLocalError] = useState('')

  async function requestCode(event?: FormEvent) {
    event?.preventDefault()
    setBusy(true); setError(null); setLocalError('')
    try {
      const next = await (purpose === 'login' ? api.emailLoginStart(email.trim()) : api.emailResetStart(email.trim()))
      setChallenge(next)
      setCode('')
      setResendAt(Date.now() + next.resendSeconds * 1000)
    } catch (reason) {
      setError(reason)
      const wait = retryAfter(reason)
      if (wait) setResendAt(wait)
    } finally {
      setBusy(false)
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault()
    if (!challenge) return
    if (purpose === 'reset') {
      if (password.length < 8) { setLocalError('Пароль должен быть не короче 8 символов.'); return }
      if (password !== repeat) { setLocalError('Пароли не совпадают.'); return }
    }
    setBusy(true); setError(null); setLocalError('')
    try {
      const result = purpose === 'login' ? await api.emailLogin(challenge.challengeId, code) : await api.emailReset(challenge.challengeId, code, password)
      auth.adopt(result.token, result.account)
      onDone()
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  const notices = <>
    {localError && <Notice tone="error">{localError}</Notice>}
    {failure(error)}
  </>

  if (!challenge) {
    return (
      <form className="form" onSubmit={requestCode}>
        <p className="lead" style={{ margin: 0 }}>{purpose === 'login'
          ? 'Введите e-mail аккаунта. Мы пришлём на него код для входа — пароль не нужен.'
          : 'Введите e-mail аккаунта. Мы пришлём на него код, после него задайте новый пароль.'}</p>
        {notices}
        <label className="field">
          <span className="field-label">E-mail</span>
          <input className="input" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus />
        </label>
        <button type="submit" className="button primary large block" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}>
          {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Mail aria-hidden="true" />}Получить код
        </button>
        {onBack && <button type="button" className="button ghost block" onClick={onBack}><LogIn aria-hidden="true" />{backLabel}</button>}
      </form>
    )
  }

  return (
    <form className="form" onSubmit={confirm}>
      <Notice tone="info">Если для {email.trim()} есть аккаунт, на этот адрес придёт письмо с кодом. Не сообщайте код никому, даже «поддержке».</Notice>
      {notices}
      <EmailCodeField value={code} onChange={setCode} />
      {purpose === 'reset' && <>
        <label className="field">
          <span className="field-label">Новый пароль</span>
          <input className="input" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="field-hint">Не короче 8 символов. Все входы на других устройствах будут завершены.</span>
        </label>
        <label className="field">
          <span className="field-label">Повторите пароль</span>
          <input className="input" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </label>
      </>}
      <button type="submit" className="button primary large block" disabled={busy || code.length !== 6}>
        {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : purpose === 'login' ? <LogIn aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
        {purpose === 'login' ? 'Войти' : 'Сохранить новый пароль'}
      </button>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <ResendButton until={resendAt} busy={busy} onClick={() => void requestCode()} />
        <button type="button" className="button ghost small" onClick={() => { setChallenge(null); setError(null) }}>Другой e-mail</button>
      </div>
    </form>
  )
}

/**
 * Cabinet: «Подтвердите e-mail» while the account's address is not confirmed (only when the server sends e-mail
 * codes). Nothing is blocked for unconfirmed accounts yet.
 */
export function EmailVerifyBanner() {
  const auth = useAuth()
  const config = useAuthConfig()
  const [challenge, setChallenge] = useState<CodeChallenge | null>(null)
  const [code, setCode] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [done, setDone] = useState(false)

  if (done) return <Notice tone="success" title="E-mail подтверждён">Спасибо! Теперь по этому адресу можно восстановить доступ к аккаунту.</Notice>
  if (!config?.emailEnabled || !auth.account || auth.account.emailVerifiedAt) return null

  async function start() {
    if (!auth.token) return
    setBusy(true); setError(null)
    try {
      const next = await api.emailVerifyStart(auth.token)
      setChallenge(next); setCode('')
      setResendAt(Date.now() + next.resendSeconds * 1000)
    } catch (reason) {
      setError(reason)
      const wait = retryAfter(reason)
      if (wait) setResendAt(wait)
    } finally {
      setBusy(false)
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault()
    if (!auth.token || !challenge) return
    setBusy(true); setError(null)
    try {
      auth.setAccount(await api.emailVerifyConfirm(auth.token, challenge.challengeId, code))
      setDone(true)
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel email-verify" aria-labelledby="email-verify-title" style={{ marginBottom: 16 }}>
      <div className="panel-header">
        <div className="panel-title" id="email-verify-title"><Mail aria-hidden="true" />Подтвердите e-mail</div>
        <span className="tag">Не подтверждён</span>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>Мы пришлём на <strong style={{ color: 'var(--text)' }}>{auth.account.email}</strong> код из 6 цифр. Подтверждённый e-mail нужен, чтобы восстановить доступ к аккаунту, если вы забудете пароль.</p>
        {failure(error)}
        {!challenge ? (
          <div><button type="button" className="button primary" disabled={busy} onClick={() => void start()}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Mail aria-hidden="true" />}Отправить код</button></div>
        ) : (
          <form className="form" onSubmit={confirm}>
            <EmailCodeField value={code} onChange={setCode} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="submit" className="button primary" disabled={busy || code.length !== 6}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <MailCheck aria-hidden="true" />}Подтвердить</button>
              <ResendButton until={resendAt} busy={busy} onClick={() => void start()} />
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
