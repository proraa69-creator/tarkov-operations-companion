import { KeyRound, LoaderCircle, LogIn, MessageSquareText, Phone, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api, errorMessage, type Account, type AuthConfig, type SmsChallenge } from '../api'
import { useAuth } from '../auth'
import { Notice } from './Notice'

/**
 * Phone number and SMS codes on the website (server/src/routes/phone.ts): binding a number in the cabinet and right
 * after registration, sign-in by phone and the password reset by phone. Everything is hidden when the server has no
 * SMS provider (GET /v1/accounts/auth-config → smsEnabled: false).
 */

let configPromise: Promise<AuthConfig> | null = null
const OFF: AuthConfig = { smsEnabled: false, codeLength: 6, codeTtlSeconds: 300, resendSeconds: 60, countries: ['7'] }

/** null while loading; an older server or a failed request counts as «SMS off». */
export function useAuthConfig() {
  const [config, setConfig] = useState<AuthConfig | null>(null)
  useEffect(() => {
    let active = true
    configPromise ??= api.authConfig().catch(() => { configPromise = null; return OFF })
    void configPromise.then((value) => { if (active) setConfig(value) })
    return () => { active = false }
  }, [])
  return config
}

export const SMS_OFF_TEXT = 'Вход и восстановление по номеру телефона на этом сервере сейчас недоступны.'

function useSecondsLeft(until: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= Date.now()) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [until])
  return Math.max(0, Math.ceil((until - now) / 1000))
}

const retryAfter = (error: unknown) => {
  const match = error instanceof ApiError ? /через (\d+) с/.exec(error.message) : null
  return match ? Date.now() + Number(match[1]) * 1000 : 0
}

export function PhoneField({ value, onChange, autoFocus }: { value: string; onChange: (value: string) => void; autoFocus?: boolean }) {
  return (
    <label className="field">
      <span className="field-label">Номер телефона</span>
      <input className="input" type="tel" inputMode="tel" autoComplete="tel" required maxLength={24} value={value} onChange={(e) => onChange(e.target.value)} placeholder="+7 999 123-45-67" autoFocus={autoFocus} />
    </label>
  )
}

export function CodeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span className="field-label">Код из SMS</span>
      <input className="input code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, '').slice(0, 6))} placeholder="000000" autoFocus />
      <span className="field-hint">6 цифр. Код действует 5 минут, после 5 неверных попыток нужен новый.</span>
    </label>
  )
}

/** «Отправить код ещё раз» with the 60-second cooldown. */
function ResendButton({ until, busy, onClick }: { until: number; busy: boolean; onClick: () => void }) {
  const left = useSecondsLeft(until)
  return (
    <button type="button" className="button ghost small" disabled={busy || left > 0} onClick={onClick}>
      <RefreshCw aria-hidden="true" />{left > 0 ? `Отправить код ещё раз через ${left} с` : 'Отправить код ещё раз'}
    </button>
  )
}

/**
 * Sign-in by phone (purpose 'login') or the password reset (purpose 'reset'): number → SMS code (→ new password).
 * The server answers the same for any number, so the page never says whether the number is registered.
 */
export function PhoneSignIn({ purpose, onDone, onBack }: { purpose: 'login' | 'reset'; onDone: () => void; onBack?: () => void }) {
  const auth = useAuth()
  const [phone, setPhone] = useState('')
  const [challenge, setChallenge] = useState<SmsChallenge | null>(null)
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
      const next = await (purpose === 'login' ? api.phoneLoginStart(phone) : api.phoneResetStart(phone))
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
      const result = purpose === 'login' ? await api.phoneLogin(challenge.challengeId, code) : await api.phoneReset(challenge.challengeId, code, password)
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
    {error !== null && <Notice tone={error instanceof ApiError && error.network ? 'offline' : 'error'}>{errorMessage(error)}</Notice>}
  </>

  if (!challenge) {
    return (
      <form className="form" onSubmit={requestCode}>
        <p className="lead" style={{ margin: 0 }}>{purpose === 'login'
          ? 'Введите номер, привязанный к аккаунту в личном кабинете. Мы пришлём код в SMS.'
          : 'Введите номер, привязанный к аккаунту. Мы пришлём код в SMS, после него задайте новый пароль.'}</p>
        {notices}
        <PhoneField value={phone} onChange={setPhone} autoFocus />
        <button type="submit" className="button primary large block" disabled={busy || phone.replace(/\D/g, '').length < 10}>
          {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <MessageSquareText aria-hidden="true" />}Получить код
        </button>
        {onBack && <button type="button" className="button ghost block" onClick={onBack}><LogIn aria-hidden="true" />Войти по e-mail и паролю</button>}
      </form>
    )
  }

  return (
    <form className="form" onSubmit={confirm}>
      <Notice tone="info">Если номер {phone} привязан к аккаунту, на него придёт SMS с кодом. Не сообщайте код никому, даже «поддержке».</Notice>
      {notices}
      <CodeField value={code} onChange={setCode} />
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
        <button type="button" className="button ghost small" onClick={() => { setChallenge(null); setError(null) }}>Другой номер</button>
      </div>
    </form>
  )
}

/**
 * Binding a number to the signed-in account: number (+ current password) → SMS code. `password` is passed right after
 * registration (the user has just typed it); in the cabinet the form asks for it.
 */
export function PhoneBind({ password: knownPassword, onDone, onCancel, cancelLabel = 'Отмена' }: { password?: string; onDone: (account: Account) => void; onCancel?: () => void; cancelLabel?: string }) {
  const auth = useAuth()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [challenge, setChallenge] = useState<SmsChallenge | null>(null)
  const [code, setCode] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function requestCode(event?: FormEvent) {
    event?.preventDefault()
    if (!auth.token) return
    setBusy(true); setError(null)
    try {
      const next = await api.phoneBindStart(auth.token, phone, knownPassword ?? password)
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
    if (!auth.token || !challenge) return
    setBusy(true); setError(null)
    try {
      const account = await api.phoneBindConfirm(auth.token, challenge.challengeId, code)
      auth.setAccount(account)
      setPassword('')
      onDone(account)
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  const notice = error !== null && <Notice tone={error instanceof ApiError && error.network ? 'offline' : 'error'}>{errorMessage(error)}</Notice>

  if (!challenge) {
    return (
      <form className="form" onSubmit={requestCode}>
        {notice}
        <PhoneField value={phone} onChange={setPhone} />
        {knownPassword === undefined && (
          <label className="field">
            <span className="field-label">Текущий пароль</span>
            <input className="input" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="submit" className="button primary" disabled={busy || phone.replace(/\D/g, '').length < 10 || (knownPassword === undefined && !password)}>
            {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <MessageSquareText aria-hidden="true" />}Получить код
          </button>
          {onCancel && <button type="button" className="button ghost" onClick={onCancel}>{cancelLabel}</button>}
        </div>
      </form>
    )
  }

  return (
    <form className="form" onSubmit={confirm}>
      <Notice tone="info">Мы отправили SMS с кодом на {phone}.</Notice>
      {notice}
      <CodeField value={code} onChange={setCode} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="submit" className="button primary" disabled={busy || code.length !== 6}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Phone aria-hidden="true" />}Подтвердить</button>
        <ResendButton until={resendAt} busy={busy} onClick={() => void requestCode()} />
        <button type="button" className="button ghost small" onClick={() => { setChallenge(null); setError(null) }}>Другой номер</button>
        {onCancel && <button type="button" className="button ghost small" onClick={onCancel}>{cancelLabel}</button>}
      </div>
    </form>
  )
}

/** Cabinet: the bound number (masked), with add / change / remove. Removing needs the current password. */
export function PhonePanel({ account }: { account: Account }) {
  const auth = useAuth()
  const config = useAuthConfig()
  const [mode, setMode] = useState<'view' | 'bind' | 'remove'>('view')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function remove(event: FormEvent) {
    event.preventDefault()
    if (!auth.token) return
    setBusy(true); setResult(null)
    try {
      auth.setAccount(await api.phoneRemove(auth.token, password))
      setPassword(''); setMode('view')
      setResult({ ok: true, message: 'Номер отвязан.' })
    } catch (reason) {
      setResult({ ok: false, message: errorMessage(reason) })
    } finally {
      setBusy(false)
    }
  }

  const enabled = config?.smsEnabled === true
  return (
    <section className="panel" aria-labelledby="phone-title">
      <div className="panel-header">
        <div className="panel-title" id="phone-title"><Phone aria-hidden="true" />Телефон</div>
        {account.phone && <span className="tag green">Подтверждён</span>}
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>{account.phone
          ? <>Номер <strong style={{ color: 'var(--text)' }}>{account.phone.masked}</strong>. По нему можно войти и восстановить пароль кодом из SMS.</>
          : 'Привяжите номер, чтобы входить по коду из SMS и восстановить пароль, если забудете его.'}</p>
        {account.owner && <Notice tone="warn">Аккаунт владельца: вход и сброс пароля по SMS для него отключены (защита от перевыпуска SIM-карты). Входите по e-mail и паролю.</Notice>}
        {config && !enabled && <Notice tone="info">{SMS_OFF_TEXT} {account.phone ? 'Отвязать номер можно и сейчас.' : 'Привязать номер можно будет позже.'}</Notice>}
        {result && <Notice tone={result.ok ? 'success' : 'error'}>{result.message}</Notice>}
        {mode === 'bind' && <PhoneBind onDone={() => { setMode('view'); setResult({ ok: true, message: 'Номер подтверждён и привязан.' }) }} onCancel={() => setMode('view')} />}
        {mode === 'remove' && (
          <form className="form" onSubmit={remove}>
            <label className="field">
              <span className="field-label">Текущий пароль</span>
              <input className="input" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="submit" className="button" disabled={busy || !password}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}Отвязать номер</button>
              <button type="button" className="button ghost" onClick={() => setMode('view')}>Отмена</button>
            </div>
          </form>
        )}
        {mode === 'view' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {enabled && <button type="button" className="button" onClick={() => { setResult(null); setMode('bind') }}><Phone aria-hidden="true" />{account.phone ? 'Сменить номер' : 'Привязать номер'}</button>}
            {account.phone && <button type="button" className="button ghost" onClick={() => { setResult(null); setMode('remove') }}><Trash2 aria-hidden="true" />Отвязать</button>}
          </div>
        )}
      </div>
    </section>
  )
}

/** Cabinet: «Сменить пароль» — the current password, then the new one; other sessions end. */
export function PasswordPanel() {
  const auth = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!auth.token) return
    if (next.length < 8) { setResult({ ok: false, message: 'Новый пароль должен быть не короче 8 символов.' }); return }
    if (next !== repeat) { setResult({ ok: false, message: 'Пароли не совпадают.' }); return }
    setBusy(true); setResult(null)
    try {
      const answer = await api.changePassword(auth.token, current, next)
      auth.adopt(answer.token, answer.account)
      setCurrent(''); setNext(''); setRepeat('')
      setResult({ ok: true, message: 'Пароль изменён. Входы на других устройствах завершены.' })
    } catch (reason) {
      setResult({ ok: false, message: errorMessage(reason) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel" aria-labelledby="password-title">
      <div className="panel-header">
        <div className="panel-title" id="password-title"><KeyRound aria-hidden="true" />Пароль</div>
      </div>
      <form className="panel-body form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Текущий пароль</span>
          <input className="input" type="password" autoComplete="current-password" required maxLength={128} value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Новый пароль</span>
          <input className="input" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Повторите новый пароль</span>
          <input className="input" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </label>
        {result && <Notice tone={result.ok ? 'success' : 'error'}>{result.message}</Notice>}
        <div><button type="submit" className="button primary" disabled={busy || !current || !next}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}Сменить пароль</button></div>
      </form>
    </section>
  )
}
