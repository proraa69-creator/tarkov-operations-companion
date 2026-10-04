import { useState, type FormEvent } from 'react'
import { AlertTriangle, Check, Gift, LoaderCircle, LogIn, Mail, QrCode, RefreshCw, UserPlus } from 'lucide-react'
import type { PendingServerRegistration, ServerAccountStatus } from '../electron'
import type { RaidMode } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { isDesktopShell } from '../platform'
import { confirmRegistrationOnServer, registerOnServer, useServerAccount, usesWebAccount } from '../sync/serverSync'
import { LEGAL_VERSION, legalUrl, PHONE_AUTH_UI } from './authFeatures'
import { CodeInput, Warning } from './codeFields'
import { postService, useCooldown, waitFrom, type CodeChallenge } from './codeRequest'
import { EmailSignInForm, EmailSignInLinks } from './EmailAccount'
import { PhoneSignInForm, PhoneSignInLinks } from './PhoneAccount'
import './account.css'

type Nicknames = Partial<Record<RaidMode, string>>
export type AccountGateTab = 'login' | 'register'

interface StepProps {
  /** Called right before a request that may sign in: the gate goes on to «Привязать ник» without showing the app. */
  onSigningIn: () => void
  onSignedIn: (nicknames?: Nicknames) => void
  /** «Продолжить без входа» while the server is offline; absent on the paywall (no way past it). */
  onSkip?: () => void
  initialTab?: AccountGateTab
}

/**
 * Step 1 of the account window (AccountController): «Вход» / «Регистрация» right in the app.
 * - Вход: e-mail + password, a code from the e-mail, «Забыли пароль?» by e-mail code (both only while the server sends
 *   e-mail codes), on the phone a hint for the QR sign-in from the PC.
 * - Регистрация: e-mail, password twice, an optional invitation code and the consent with the documents on raidos.app;
 *   with e-mail codes on, the code from the e-mail creates the account, otherwise it is signed in at once.
 * The desktop app goes through the main process (electron/serviceGateway.ts: the session never reaches this page),
 * the phone through sync/webAccount.ts. Phone / SMS options stay hidden while PHONE_AUTH_UI is off.
 */
export function SignInStep({ onSigningIn, onSignedIn, onSkip, initialTab = 'login' }: StepProps) {
  const { status, checking, refresh } = useServerAccount()
  const [tab, setTab] = useState<AccountGateTab>(initialTab)
  const [emailMode, setEmailMode] = useState<'login' | 'reset' | null>(null)
  const [phoneMode, setPhoneMode] = useState<'login' | 'reset' | null>(null)
  const online = status?.online ?? false
  const signedIn = (next: ServerAccountStatus) => { onSigningIn(); onSignedIn(next.nicknames) }
  // The tab names by locale: a bare «Вход» in the shared dictionary would also rename map labels («Вход в …»).
  const { locale } = useLocale()
  const en = locale === 'en'

  let body
  if (emailMode) {
    body = <>
      <h2>{uiText(emailMode === 'login' ? 'Вход по коду из письма' : 'Восстановление пароля')}</h2>
      <EmailSignInForm purpose={emailMode} onSignedIn={signedIn} onBack={() => setEmailMode(null)} />
    </>
  } else if (PHONE_AUTH_UI && phoneMode) {
    body = <>
      <h2>{uiText(phoneMode === 'login' ? 'Вход по коду из SMS' : 'Восстановление пароля')}</h2>
      <PhoneSignInForm purpose={phoneMode} onSignedIn={signedIn} onBack={() => setPhoneMode(null)} />
    </>
  } else {
    body = <>
      <h2>{tab === 'login' ? uiText('Вход в аккаунт') : en ? 'Create an account' : 'Регистрация'}</h2>
      <div className="mode-switch wide account-gate-tabs" role="tablist" aria-label={uiText('Аккаунт')}>
        <button type="button" role="tab" id="account-gate-tab-login" aria-selected={tab === 'login'} aria-controls="account-gate-panel" className={tab === 'login' ? 'active' : ''} onClick={() => setTab('login')}><LogIn size={14} />{en ? 'Sign in' : 'Вход'}</button>
        <button type="button" role="tab" id="account-gate-tab-register" aria-selected={tab === 'register'} aria-controls="account-gate-panel" className={tab === 'register' ? 'active' : ''} onClick={() => setTab('register')}><UserPlus size={14} />{en ? 'Sign up' : 'Регистрация'}</button>
      </div>
      <div id="account-gate-panel" role="tabpanel" aria-labelledby={`account-gate-tab-${tab}`}>
        {tab === 'login'
          ? <PasswordSignIn online={online} onSigningIn={onSigningIn} onSignedIn={onSignedIn} onPickEmail={setEmailMode} onPickPhone={setPhoneMode} onRegister={() => setTab('register')} />
          : <Registration online={online} onSigningIn={onSigningIn} onSignedIn={onSignedIn} onLogin={() => setTab('login')} />}
      </div>
    </>
  }

  return (
    <div className="stack account-gate-form">
      <div className="eyebrow">{uiText('Raid OS · шаг 1 из 2')}</div>
      {body}
      {status && !online && <div className="import-warning"><AlertTriangle size={17} /><span>{uiText('Сервер недоступен. Проверьте интернет и адрес сервера или попробуйте позже.')}</span></div>}
      {status && !online && (
        <div className="account-gate-offline">
          <button type="button" className="button ghost" onClick={() => void refresh()} disabled={checking}><RefreshCw size={14} className={checking ? 'spin' : ''} />{uiText('Проверить снова')}</button>
          {onSkip && <button type="button" className="button ghost" onClick={onSkip}>{uiText('Продолжить без входа')}</button>}
        </div>
      )}
    </div>
  )
}

function PasswordSignIn({ online, onSigningIn, onSignedIn, onPickEmail, onPickPhone, onRegister }: {
  online: boolean
  onSigningIn: () => void
  onSignedIn: (nicknames?: Nicknames) => void
  onPickEmail: (purpose: 'login' | 'reset') => void
  onPickPhone: (purpose: 'login' | 'reset') => void
  onRegister: () => void
}) {
  const { login } = useServerAccount()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The phone signs in by the QR code of the signed-in PC app (Профиль → «Войти в мобильную версию»).
  const phone = usesWebAccount() && !isDesktopShell()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    onSigningIn()
    try {
      const next = await login(email, password)
      setPassword('')
      onSignedIn(next.nicknames)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Сервер недоступен')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack account-gate-form" onSubmit={(event) => void submit(event)}>
      <label className="field-label">{uiText('E-mail')}
        <input className="input" type="email" autoComplete="username" value={email} maxLength={254} onChange={(event) => setEmail(event.target.value)} required autoFocus />
      </label>
      <label className="field-label">{uiText('Пароль')}
        <input className="input" type="password" autoComplete="current-password" value={password} minLength={8} maxLength={128} onChange={(event) => setPassword(event.target.value)} required />
      </label>
      <Warning text={error} />
      <button className="button primary account-gate-submit" type="submit" disabled={busy || !online}>
        {busy ? <LoaderCircle className="spin" size={16} /> : <LogIn size={16} />}{uiText(busy ? 'Входим…' : 'Войти')}
      </button>
      <EmailSignInLinks online={online} onPick={onPickEmail} />
      {PHONE_AUTH_UI && <PhoneSignInLinks online={online} onPick={onPickPhone} resetLabel="Сбросить пароль по SMS" />}
      {phone && <p className="dim account-gate-hint"><QrCode size={14} />{uiText('Вход по QR-коду: в приложении на компьютере откройте Профиль → «Войти в мобильную версию» и наведите камеру телефона на QR-код.')}</p>}
      <div className="account-gate-links">
        <span>{uiText('Нет аккаунта?')}</span>
        <button type="button" className="link-button" onClick={onRegister}><UserPlus size={14} />{uiText('Зарегистрироваться')}</button>
      </div>
    </form>
  )
}

const REFERRAL_CODE = /^[a-zA-Z0-9_-]{3,24}$/

function Registration({ online, onSigningIn, onSignedIn, onLogin }: {
  online: boolean
  onSigningIn: () => void
  onSignedIn: (nicknames?: Nicknames) => void
  onLogin: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [referral, setReferral] = useState('')
  const [showCode, setShowCode] = useState(false)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // With e-mail codes on the server: the account appears only after the code from the e-mail.
  const [pending, setPending] = useState<{ registration: PendingServerRegistration; email: string } | null>(null)
  const [code, setCode] = useState('')
  const cooldown = useCooldown()

  /** The account exists and the app is signed in: record the accepted documents, then the nickname step. */
  const finish = (status: ServerAccountStatus) => {
    // The server keeps the version of the accepted documents and the time (152-ФЗ: consent must be provable).
    void postService('/v1/accounts/me/consents', { kind: 'registration', version: LEGAL_VERSION }).catch(() => undefined)
    setPassword(''); setRepeat('')
    onSignedIn(status.nicknames)
  }

  const fail = (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    setError(message)
    if (waitFrom(message)) cooldown.start(waitFrom(message))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const invite = referral.trim()
    if (password.length < 8) { setError('Пароль должен быть не короче 8 символов.'); return }
    if (password !== repeat) { setError('Пароли не совпадают.'); return }
    if (invite && !REFERRAL_CODE.test(invite)) { setError('Код приглашения: 3–24 символа, латиница, цифры, «_» или «-».'); return }
    if (!consent) { setError('Отметьте согласие с офертой и на обработку персональных данных.'); return }
    setBusy(true); setError('')
    onSigningIn()
    try {
      const result = await registerOnServer(email, password, invite || undefined)
      if (result.pending) {
        setPending({ registration: result.pending, email: email.trim() })
        setCode('')
        cooldown.start(result.pending.resendSeconds)
      } else {
        finish(result.status)
      }
    } catch (reason) {
      fail(reason)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (event: FormEvent) => {
    event.preventDefault()
    if (!pending || busy) return
    setBusy(true); setError('')
    onSigningIn()
    try {
      const result = await confirmRegistrationOnServer(pending.registration.challengeId, code)
      finish(result.status)
    } catch (reason) {
      fail(reason)
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    if (!pending || busy) return
    setBusy(true); setError('')
    try {
      const next = await postService('/v1/accounts/register/resend', { challengeId: pending.registration.challengeId }) as CodeChallenge
      setPending({ ...pending, registration: { ...pending.registration, ...next } })
      setCode('')
      cooldown.start(next.resendSeconds)
    } catch (reason) {
      fail(reason)
    } finally {
      setBusy(false)
    }
  }

  if (pending) {
    return (
      <form className="stack account-gate-form" onSubmit={(event) => void confirm(event)}>
        <div className="account-gate-pending" role="status"><Mail size={18} /><span>{uiText(pending.registration.message)}<small>{pending.email}</small></span></div>
        <p className="muted">{uiText('Код из 6 цифр действует 10 минут. Не пришло письмо — проверьте папку «Спам».')}</p>
        <CodeInput value={code} onChange={setCode} />
        <Warning text={error} />
        <button className="button primary account-gate-submit" type="submit" disabled={busy || code.length !== 6}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{uiText('Подтвердить и войти')}
        </button>
        <div className="account-gate-links">
          <button type="button" className="link-button" disabled={busy || cooldown.left > 0} onClick={() => void resend()}><RefreshCw size={14} />{uiText('Отправить код ещё раз')}{cooldown.left > 0 ? ` (${cooldown.left})` : ''}</button>
          <button type="button" className="link-button" onClick={() => { setPending(null); setError(''); setCode('') }}>{uiText('Другой e-mail')}</button>
        </div>
      </form>
    )
  }

  return (
    <form className="stack account-gate-form" onSubmit={(event) => void submit(event)}>
      <p className="muted">{uiText('Один аккаунт для сайта и приложения: ники, прогресс заданий и подписка хранятся в нём.')}</p>
      <label className="field-label">{uiText('E-mail')}
        <input className="input" type="email" autoComplete="email" value={email} maxLength={254} placeholder="you@example.com" onChange={(event) => setEmail(event.target.value)} required autoFocus />
      </label>
      <label className="field-label">{uiText('Пароль')}
        <input className="input" type="password" autoComplete="new-password" value={password} minLength={8} maxLength={128} onChange={(event) => setPassword(event.target.value)} required />
      </label>
      <label className="field-label">{uiText('Повторите пароль')}
        <input className="input" type="password" autoComplete="new-password" value={repeat} minLength={8} maxLength={128} onChange={(event) => setRepeat(event.target.value)} required />
      </label>
      {showCode ? (
        <label className="field-label">{uiText('Код приглашения (необязательно)')}
          <input className="input" autoComplete="off" spellCheck={false} maxLength={24} value={referral} placeholder="HUNTER_TV" onChange={(event) => setReferral(event.target.value)} />
          {referral.trim() && <small className="dim"><Gift size={12} /> {uiText('По коду приглашения — 3 дня бесплатного доступа.')}</small>}
        </label>
      ) : (
        <button type="button" className="link-button account-gate-invite" onClick={() => setShowCode(true)}><Gift size={14} />{uiText('У меня есть код приглашения')}</button>
      )}
      <label className="account-consent">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <ConsentText />
      </label>
      <Warning text={error} />
      <button className="button primary account-gate-submit" type="submit" disabled={busy || !online || !consent}>
        {busy ? <LoaderCircle className="spin" size={16} /> : <UserPlus size={16} />}{uiText(busy ? 'Создаём аккаунт…' : 'Зарегистрироваться')}
      </button>
      <div className="account-gate-links">
        <span>{uiText('Уже есть аккаунт?')}</span>
        <button type="button" className="link-button" onClick={onLogin}><LogIn size={14} />{uiText('Войти')}</button>
      </div>
    </form>
  )
}

/** The documents open on raidos.app in the system browser (the desktop shell and the phone open https links outside). */
function ConsentText() {
  const { locale } = useLocale()
  const link = (slug: 'offer' | 'consent' | 'privacy', text: string) => <a href={legalUrl(slug)} target="_blank" rel="noopener noreferrer">{text}</a>
  return locale === 'en'
    ? <span>I accept the {link('offer', 'terms of the offer')} and give my {link('consent', 'consent to the processing of personal data')} under the {link('privacy', 'privacy policy')}</span>
    : <span>Я принимаю условия {link('offer', 'оферты')} и даю {link('consent', 'согласие на обработку персональных данных')} в соответствии с {link('privacy', 'политикой конфиденциальности')}</span>
}
