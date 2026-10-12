import { Clock, Gift, LoaderCircle, UserPlus, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ApiError, api, errorMessage, type PendingRegistration } from '../api'
import { useAuth } from '../auth'
import { ConsentCheckbox } from '../components/ConsentCheckbox'
import { Notice } from '../components/Notice'
import { RegistrationCodeStep } from '../components/EmailAuth'
import { tr } from '../i18n'
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
  // With e-mail codes on: the account appears only after the code from the e-mail (server/src/routes/email.ts).
  const [pending, setPending] = useState<{ registration: PendingRegistration; email: string; code: string } | null>(null)

  /** The account exists and this browser is signed in: consent, then the cabinet. */
  function finished(token: string, referralApplied: boolean, code: string) {
    // The server keeps the version of the accepted documents and the time (152-ФЗ: consent must be provable).
    void api.recordConsent(token, 'registration', LEGAL_VERSION).catch(() => undefined)
    saveReferralCode(null)
    const referralRejected = Boolean(code) && !referralApplied
    navigate('/cabinet', { replace: true, state: { welcome: true, referralRejected } })
  }

  if (pending) {
    return (
      <div className="container auth-wrap page-in">
        <div className="panel auth-card">
          <div className="eyebrow">{tr('Регистрация · подтверждение e-mail')}</div>
          <h1>{tr('Проверьте почту')}</h1>
          <RegistrationCodeStep email={pending.email} pending={pending.registration}
            onDone={({ token, referralApplied }) => { const code = pending.code; setPending(null); finished(token, referralApplied, code) }}
            onBack={() => setPending(null)} />
        </div>
      </div>
    )
  }

  if (auth.status === 'ready') return <Navigate to="/cabinet" replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const code = normalizeReferralCode(referral)
    if (password.length < 8) { setLocalError(tr('Пароль должен быть не короче 8 символов.')); return }
    if (password !== repeat) { setLocalError(tr('Пароли не совпадают.')); return }
    if (code && !REFERRAL_CODE_PATTERN.test(code)) { setLocalError(tr('Код приглашения: 3–24 символа, латиница, цифры, «_» или «-».')); return }
    if (!consent) { setLocalError(tr('Отметьте согласие с офертой и на обработку персональных данных.')); return }
    setLocalError(null)
    setBusy(true)
    try {
      const result = await auth.register(email, password, code || undefined)
      // E-mail codes on: the same answer for every address; the account appears after the code.
      if (result.pending) setPending({ registration: result.pending, email: email.trim(), code })
      else finished(result.token, result.referralApplied, code)
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container auth-wrap page-in">
      <div className="panel auth-card">
        <div className="eyebrow">{tr('Аккаунт')}</div>
        <h1>{tr('Регистрация')}</h1>
        <p className="lead">{tr('Один аккаунт для сайта и приложения.')}</p>
        {/* owner, 12.10.2026: «При регистрации пиши что даются сутки бесплатно… и если по его ссылке пришли оплатившие друзья, то ему дают бонусы» */}
        <ul className="auth-perks">
          <li><Clock aria-hidden="true" /><span><strong>{tr('Сутки бесплатно')}</strong> {tr('с первого входа в приложение Raid OS, без оплаты.')}</span></li>
          <li><Users aria-hidden="true" /><span>{tr('Пригласите друзей: за каждого, кто по вашей ссылке оплатит первый месяц со скидкой 20 %, — 7 дней Premium, даже если сами вы ещё не платили.')}</span></li>
        </ul>
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
            <span className="field-label">{tr('Пароль')}</span>
            <input className="input" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
            <span className="field-hint">{tr('Не короче 8 символов.')}</span>
          </label>
          <label className="field">
            <span className="field-label">{tr('Повторите пароль')}</span>
            <input className="input" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </label>
          {linkCode && !showCode ? (
            <div className="notice success" role="status">
              <Gift aria-hidden="true" />
              <div><strong>{tr('Вы пришли по приглашению · {code}', { code: linkCode })}</strong>{tr('Код применится автоматически — вводить ничего не нужно. Скидка 20 % действует на первый месяц по ссылке друга.')}</div>
            </div>
          ) : showCode || referral.trim() ? (
            <label className="field">
              <span className="field-label">{tr('Код приглашения')} <span className="dim">{tr('(необязательно)')}</span></span>
              <input className="input code" autoComplete="off" spellCheck={false} maxLength={24} value={referral} onChange={(e) => setReferral(e.target.value)} placeholder="RAID-XXXXX" />
              <span className="field-hint"><Gift size={12} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 5 }} />{tr('Код друга даёт скидку 20 % на первый месяц.')}</span>
            </label>
          ) : (
            <button type="button" className="button ghost small" style={{ justifySelf: 'start' }} onClick={() => setShowCode(true)}><Gift aria-hidden="true" />{tr('У меня есть код приглашения')}</button>
          )}
          <ConsentCheckbox checked={consent} onChange={setConsent} id="register-consent" />
          <button type="submit" className="button primary large block" disabled={busy || !consent}>
            {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
            {busy ? tr('Создаём аккаунт…') : tr('Зарегистрироваться')}
          </button>
        </form>
        <p className="auth-switch">{tr('Уже есть аккаунт?')} <Link to="/login">{tr('Войти')}</Link></p>
      </div>
    </div>
  )
}
