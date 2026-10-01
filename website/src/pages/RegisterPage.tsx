import { Gift, LoaderCircle, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ApiError, api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { ConsentCheckbox } from '../components/ConsentCheckbox'
import { Notice } from '../components/Notice'
import { PhoneBind, useAuthConfig } from '../components/PhoneAuth'
import { LEGAL_VERSION } from '../legal/documents'
import { loadReferralCode, normalizeReferralCode, REFERRAL_CODE_PATTERN, saveReferralCode } from '../storage'

export function RegisterPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  // A code remembered from a streamer's link (/r/CODE) is applied automatically: no promo code to type.
  const [linkCode] = useState(() => loadReferralCode())
  const [referral, setReferral] = useState(() => linkCode ?? '')
  const [showCode, setShowCode] = useState(false)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const config = useAuthConfig()
  // After registration, with SMS on: an optional step to confirm a phone number (skippable).
  const [phoneStep, setPhoneStep] = useState<{ referralRejected: boolean } | null>(null)

  if (phoneStep) {
    const finish = () => navigate('/cabinet', { replace: true, state: { welcome: true, referralRejected: phoneStep.referralRejected } })
    return (
      <div className="container auth-wrap page-in">
        <div className="panel auth-card">
          <div className="eyebrow">Аккаунт создан · необязательный шаг</div>
          <h1>Номер телефона</h1>
          <p className="lead">Привяжите номер: по коду из SMS можно будет войти и восстановить пароль. Номер не виден другим людям и используется только для кодов.</p>
          <PhoneBind password={password} onDone={finish} onCancel={finish} cancelLabel="Пропустить" />
        </div>
      </div>
    )
  }

  if (auth.status === 'ready') return <Navigate to="/cabinet" replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const code = normalizeReferralCode(referral)
    if (password.length < 8) { setLocalError('Пароль должен быть не короче 8 символов.'); return }
    if (password !== repeat) { setLocalError('Пароли не совпадают.'); return }
    if (code && !REFERRAL_CODE_PATTERN.test(code)) { setLocalError('Код приглашения: 3–24 символа, латиница, цифры, «_» или «-».'); return }
    if (!consent) { setLocalError('Отметьте согласие с офертой и на обработку персональных данных.'); return }
    setLocalError(null)
    setBusy(true)
    try {
      const { token, referralApplied } = await auth.register(email, password, code || undefined)
      // The server keeps the version of the accepted documents and the time (152-ФЗ: consent must be provable).
      void api.recordConsent(token, 'registration', LEGAL_VERSION).catch(() => undefined)
      saveReferralCode(null)
      const referralRejected = Boolean(code) && !referralApplied
      if (config?.smsEnabled) setPhoneStep({ referralRejected })
      else navigate('/cabinet', { replace: true, state: { welcome: true, referralRejected } })
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
          {linkCode && !showCode ? (
            <div className="notice success" role="status">
              <Gift aria-hidden="true" />
              <div><strong>Вы пришли по приглашению · {linkCode}</strong>Код применится автоматически — 3 дня бесплатного доступа. Вводить ничего не нужно.</div>
            </div>
          ) : showCode || referral.trim() ? (
            <label className="field">
              <span className="field-label">Код приглашения <span className="dim">(необязательно)</span></span>
              <input className="input code" autoComplete="off" spellCheck={false} maxLength={24} value={referral} onChange={(e) => setReferral(e.target.value)} placeholder="HUNTER_TV" />
              {referral.trim() && <span className="field-hint"><Gift size={12} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 5 }} />По коду приглашения — 3 дня бесплатного доступа.</span>}
            </label>
          ) : (
            <button type="button" className="button ghost small" style={{ justifySelf: 'start' }} onClick={() => setShowCode(true)}><Gift aria-hidden="true" />У меня есть код приглашения</button>
          )}
          <ConsentCheckbox checked={consent} onChange={setConsent} id="register-consent" />
          <button type="submit" className="button primary large block" disabled={busy || !consent}>
            {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
            {busy ? 'Создаём аккаунт…' : 'Зарегистрироваться'}
          </button>
        </form>
        <p className="auth-switch">Уже есть аккаунт? <Link to="/login">Войти</Link></p>
      </div>
    </div>
  )
}
