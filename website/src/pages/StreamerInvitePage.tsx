import { CalendarClock, Home, Link2Off, LoaderCircle, LogIn, Radio, RefreshCw, UserPlus, WifiOff } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api, errorMessage, STREAMER_INVITE_PATTERN, type PendingRegistration, type StreamerInvite } from '../api'
import { useAuth } from '../auth'
import { CountrySelect } from '../components/CountrySelect'
import { Notice } from '../components/Notice'
import { RegistrationCodeStep } from '../components/EmailAuth'
import { localeTag, tr } from '../i18n'

const formatDateTime = (value: string) => new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(value))

/** A translated sentence with an element in it: `{slot}` in the phrase marks where the element goes. */
function withSlot(text: string, element: ReactNode) {
  const [before, after = ''] = text.split('{slot}')
  return <>{before}{element}{after}</>
}

type InviteState =
  | { status: 'loading' }
  | { status: 'valid'; invite: StreamerInvite }
  | { status: 'invalid' }
  | { status: 'error'; error: unknown; offline: boolean }

/** Secret pages must stay out of search results. */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])
}

/**
 * Hidden page for a one-time streamer invitation: /streamer/<token>. Not linked from the site navigation.
 * The token is checked first; then the person registers or signs in right here and the invite is redeemed.
 * Registration here never sends a referral code: a streamer account is not somebody's referral.
 */
export function StreamerInvitePage() {
  useNoIndex()
  const { token: inviteToken = '' } = useParams()
  const [state, setState] = useState<InviteState>(() => (STREAMER_INVITE_PATTERN.test(inviteToken) ? { status: 'loading' } : { status: 'invalid' }))
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!STREAMER_INVITE_PATTERN.test(inviteToken)) return
    let cancelled = false
    api.streamerInvite(inviteToken).then(
      (invite) => { if (!cancelled) setState({ status: 'valid', invite }) },
      (reason: unknown) => {
        if (cancelled) return
        if (reason instanceof ApiError && reason.status === 404) setState({ status: 'invalid' })
        else setState({ status: 'error', error: reason, offline: reason instanceof ApiError && reason.network })
      },
    )
    return () => { cancelled = true }
  }, [inviteToken, attempt])

  if (state.status === 'loading') {
    return (
      <div className="container page">
        <div className="panel center-state"><LoaderCircle className="spinner" aria-hidden="true" /><div>{tr('Проверяем приглашение…')}</div></div>
      </div>
    )
  }

  if (state.status === 'invalid' || state.status === 'error') {
    const invalid = state.status === 'invalid'
    return (
      <div className="container page page-in">
        <div className="panel center-state" style={{ padding: 24 }}>
          {invalid ? <Link2Off aria-hidden="true" /> : state.offline ? <WifiOff aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          <div style={{ maxWidth: 460 }}>
            <h1 style={{ margin: '0 0 8px', fontSize: 24, color: 'var(--text)' }}>{invalid ? tr('Приглашение недействительно') : tr('Не удалось проверить приглашение')}</h1>
            <p style={{ margin: 0 }}>
              {invalid
                ? tr('Ссылка не найдена, уже использована или срок её действия истёк. Попросите новую ссылку у владельца сервиса.')
                : errorMessage(state.error)}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {!invalid && <button type="button" className="button primary" onClick={() => { setState({ status: 'loading' }); setAttempt((n) => n + 1) }}><RefreshCw aria-hidden="true" />{tr('Повторить')}</button>}
            <Link to="/" className="button ghost"><Home aria-hidden="true" />{tr('На главную')}</Link>
          </div>
        </div>
      </div>
    )
  }

  return <InviteCard invite={state.invite} inviteToken={inviteToken} />
}

function InviteCard({ invite, inviteToken }: { invite: StreamerInvite; inviteToken: string }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const [haveAccount, setHaveAccount] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  // A new streamer account names its country like any registration (owner, 13.10.2026).
  const [country, setCountry] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  // True while the form's login/registration is followed by the redeem call: keep the form (with its spinner) on screen.
  const [viaForm, setViaForm] = useState(false)
  // A new account while the server sends e-mail codes: the code step comes before the invitation is redeemed.
  const [pending, setPending] = useState<PendingRegistration | null>(null)

  async function redeem(token: string) {
    const account = await api.redeemStreamerInvite(token, inviteToken)
    auth.setAccount(account)
    navigate('/cabinet', { replace: true, state: { streamerWelcome: account.referralCode ?? invite.code } })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!haveAccount) {
      if (password.length < 8) { setLocalError(tr('Пароль должен быть не короче 8 символов.')); return }
      if (password !== repeat) { setLocalError(tr('Пароли не совпадают.')); return }
      if (!country) { setLocalError(tr('Выберите страну.')); return }
    }
    setLocalError(null)
    setBusy(true)
    setViaForm(true)
    let signedInNow = false
    try {
      // No referral code on purpose, even if one is remembered from an earlier /r/<code> visit.
      const result = haveAccount ? await auth.login(email, password) : await auth.register(email, password, undefined, country)
      if ('pending' in result && result.pending) { setPending(result.pending); setBusy(false); return }
      if (!('token' in result)) return
      signedInNow = true
      await redeem(result.token)
    } catch (reason) {
      setError(reason)
      setBusy(false)
      // Signed in but the invite failed: fall back to the signed-in view, which shows the error and a retry button.
      if (signedInNow) setViaForm(false)
    }
  }

  async function become() {
    if (!auth.token) return
    setError(null)
    setBusy(true)
    try {
      await redeem(auth.token)
    } catch (reason) {
      setError(reason)
      setBusy(false)
    }
  }

  const errorNotice = error !== null && (
    <Notice tone={error instanceof ApiError && error.network ? 'offline' : 'error'}>{errorMessage(error)}</Notice>
  )
  const signedIn = auth.status === 'ready' && auth.account !== null
  const showForm = !signedIn || viaForm

  return (
    <div className="container auth-wrap page-in">
      <div className="panel auth-card invite-card">
        <div className="eyebrow">{tr('Приглашение стримера')}</div>
        <h1>{tr('Кабинет стримера')}</h1>
        <p className="lead">{tr('Вас пригласили в партнёрскую программу Raid OS.')}</p>

        <div className="invite-code">
          <span className="field-label"><Radio size={12} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 5 }} />{tr('Ваш код стримера')}</span>
          <code>{invite.code}</code>
          <span className="field-hint"><CalendarClock size={12} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 5 }} />{tr('Ссылка одноразовая, действует до {date}.', { date: formatDateTime(invite.expiresAt) })}</span>
        </div>

        <ul className="invite-points">
          <li>{withSlot(tr('Личная ссылка {slot} и код для зрителей — по ним дают 3 дня бесплатного доступа.'), <span className="mono">/r/{invite.code}</span>)}</li>
          <li>{tr('В кабинете видно переходы, регистрации, активные подписки, выручку по ссылке и ваши начисления.')}</li>
          <li>{tr('Выплаты начислений согласуются с владельцем сервиса.')}</li>
        </ul>

        {pending ? (
          <>
            {errorNotice}
            <RegistrationCodeStep email={email.trim()} pending={pending}
              onDone={({ token }) => {
                setPending(null)
                setBusy(true)
                redeem(token).catch((reason: unknown) => { setError(reason); setBusy(false); setViaForm(false) })
              }}
              onBack={() => { setPending(null); setViaForm(false) }} />
          </>
        ) : auth.status === 'loading' ? (
          <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}><LoaderCircle className="spinner" size={16} aria-hidden="true" />{tr('Проверяем вход…')}</div>
        ) : signedIn && !showForm ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {auth.account!.kind === 'streamer' ? (
              <Notice tone="info" title={tr('Этот аккаунт уже стримерский')}>{withSlot(tr('Вы вошли как {email}. Код стримера уже привязан — откройте {slot}.', { email: auth.account!.email }), <Link to="/cabinet" style={{ color: 'var(--brass-strong)', fontWeight: 700 }}>{tr('личный кабинет')}</Link>)}</Notice>
            ) : (
              <>
                <p className="muted" style={{ margin: 0, fontSize: 14 }}>{withSlot(tr('Вы вошли как {slot}. Код будет привязан к этому аккаунту.'), <strong style={{ color: 'var(--text)' }}>{auth.account!.email}</strong>)}</p>
                {errorNotice}
                <button type="button" className="button primary large block" disabled={busy} onClick={() => void become()}>
                  {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Radio aria-hidden="true" />}
                  {tr('Стать стримером с кодом {code}', { code: invite.code })}
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <div role="tablist" aria-label={tr('Аккаунт')} className="invite-switch">
              <button type="button" role="tab" aria-selected={!haveAccount} className={`button small ${haveAccount ? 'ghost' : 'primary'}`} disabled={busy} onClick={() => { setHaveAccount(false); setError(null); setLocalError(null) }}>{tr('Новый аккаунт')}</button>
              <button type="button" role="tab" aria-selected={haveAccount} className={`button small ${haveAccount ? 'primary' : 'ghost'}`} disabled={busy} onClick={() => { setHaveAccount(true); setError(null); setLocalError(null) }}>{tr('У меня уже есть аккаунт')}</button>
            </div>
            <form className="form" onSubmit={submit}>
              {localError && <Notice tone="error">{localError}</Notice>}
              {errorNotice}
              <label className="field">
                <span className="field-label">E-mail</span>
                <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </label>
              <label className="field">
                <span className="field-label">{tr('Пароль')}</span>
                <input className="input" type="password" autoComplete={haveAccount ? 'current-password' : 'new-password'} required minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
                {!haveAccount && <span className="field-hint">{tr('Не короче 8 символов.')}</span>}
              </label>
              {!haveAccount && (
                <label className="field">
                  <span className="field-label">{tr('Повторите пароль')}</span>
                  <input className="input" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
                </label>
              )}
              {!haveAccount && <CountrySelect value={country} onChange={setCountry} />}
              <button type="submit" className="button primary large block" disabled={busy}>
                {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : haveAccount ? <LogIn aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
                {haveAccount ? tr('Войти и стать стримером') : tr('Создать аккаунт стримера')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
