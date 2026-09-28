import { Gift, LoaderCircle, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ApiError, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Notice } from '../components/Notice'
import { loadReferralCode, normalizeReferralCode, REFERRAL_CODE_PATTERN, saveReferralCode } from '../storage'

export function RegisterPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [referral, setReferral] = useState(() => loadReferralCode() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  if (auth.status === 'ready') return <Navigate to="/cabinet" replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const code = normalizeReferralCode(referral)
    if (password.length < 8) { setLocalError('Пароль должен быть не короче 8 символов.'); return }
    if (password !== repeat) { setLocalError('Пароли не совпадают.'); return }
    if (code && !REFERRAL_CODE_PATTERN.test(code)) { setLocalError('Код приглашения: 3–24 символа, латиница, цифры, «_» или «-».'); return }
    setLocalError(null)
    setBusy(true)
    try {
      const { referralApplied } = await auth.register(email, password, code || undefined)
      saveReferralCode(null)
      navigate('/cabinet', { replace: true, state: { welcome: true, referralRejected: Boolean(code) && !referralApplied } })
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container auth-wrap page-in">
      <div className="panel auth-card">
        <div className="eyebrow">Аккаунт</div>
        <h1>Регистрация</h1>
        <p className="lead">Один аккаунт для сайта и приложения.</p>
        <form className="form" onSubmit={submit}>
          {localError && <Notice tone="error">{localError}</Notice>}
          {error !== null && (
            <Notice tone={error instanceof ApiError && error.network ? 'offline' : 'error'}>{errorMessage(error)}</Notice>
          )}
          <label className="field">
            <span className="field-label">E-mail</span>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label className="field">
            <span className="field-label">Пароль</span>
            <input className="input" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
            <span className="field-hint">Не короче 8 символов.</span>
          </label>
          <label className="field">
            <span className="field-label">Повторите пароль</span>
            <input className="input" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Код приглашения <span className="dim">(необязательно)</span></span>
            <input className="input code" autoComplete="off" spellCheck={false} maxLength={24} value={referral} onChange={(e) => setReferral(e.target.value)} placeholder="Например, HUNTER_TV" />
            {referral.trim() && <span className="field-hint"><Gift size={12} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 5 }} />По коду приглашения — 3 дня бесплатного доступа.</span>}
          </label>
          <button type="submit" className="button primary large block" disabled={busy}>
            {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
            {busy ? 'Создаём аккаунт…' : 'Зарегистрироваться'}
          </button>
        </form>
        <p className="auth-switch">Уже есть аккаунт? <Link to="/login">Войти</Link></p>
      </div>
    </div>
  )
}
