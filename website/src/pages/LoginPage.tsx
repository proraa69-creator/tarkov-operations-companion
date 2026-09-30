import { LoaderCircle, LogIn, QrCode, RefreshCw } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ApiError, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Notice } from '../components/Notice'
import { LoginQr } from '../components/LoginQr'
import { qrLogin, type QrLoginRequest } from '../qrLogin'
import '../qrLogin.css'

export function LoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [withQr, setWithQr] = useState(false)

  if (auth.status === 'ready') return <Navigate to="/cabinet" replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await auth.login(email, password)
      navigate('/cabinet', { replace: true })
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
        <h1>Вход</h1>
        {withQr ? <QrSignIn onBack={() => setWithQr(false)} /> : <>
          <p className="lead">Войдите, чтобы открыть личный кабинет.</p>
          <form className="form" onSubmit={submit} noValidate={false}>
            {error !== null && (
              <Notice tone={error instanceof ApiError && error.network ? 'offline' : 'error'}>{errorMessage(error)}</Notice>
            )}
            <label className="field">
              <span className="field-label">E-mail</span>
              <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>
            <label className="field">
              <span className="field-label">Пароль</span>
              <input className="input" type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button type="submit" className="button primary large block" disabled={busy}>
              {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <LogIn aria-hidden="true" />}
              {busy ? 'Входим…' : 'Войти'}
            </button>
          </form>
          <div className="auth-divider">или</div>
          <button type="button" className="button large block" onClick={() => setWithQr(true)}><QrCode aria-hidden="true" />Войти по QR-коду</button>
        </>}
        <p className="auth-switch">Нет аккаунта? <Link to="/register">Зарегистрироваться</Link></p>
      </div>
    </div>
  )
}

const POLL_MS = 2000

/**
 * «Войти по QR-коду»: the site shows a one-time code (2 minutes) as a QR code and as text. A signed-in phone app
 * scans it, or the desktop app takes the typed code (Профиль → «Подтвердить вход на сайте»); this page then gets a
 * session for this browser only. No password and no session token ever travel in the code.
 */
function QrSignIn({ onBack }: { onBack: () => void }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const [request, setRequest] = useState<QrLoginRequest | null>(null)
  const [expired, setExpired] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let active = true
    qrLogin.start().then((value) => { if (active) { setRequest(value); setExpired(false); setError(null) } }, (reason: unknown) => { if (active) setError(reason) })
    return () => { active = false }
  }, [attempt])

  useEffect(() => {
    if (!request || expired) return
    let active = true
    const tick = async () => {
      if (!active) return
      setNow(Date.now())
      try {
        const answer = await qrLogin.poll(request)
        if (!active) return
        if (answer.status === 'done') { auth.adopt(answer.token, answer.account); navigate('/cabinet', { replace: true }); return }
        if (answer.status === 'expired' || Date.parse(request.expiresAt) <= Date.now()) { setExpired(true); return }
      } catch (reason) {
        if (!active) return
        if (!(reason instanceof ApiError && (reason.network || reason.status === 429))) { setError(reason); return }
      }
      timer = window.setTimeout(() => void tick(), POLL_MS)
    }
    let timer = window.setTimeout(() => void tick(), POLL_MS)
    return () => { active = false; window.clearTimeout(timer) }
  }, [request, expired, auth, navigate])

  const left = request ? Math.max(0, Math.round((Date.parse(request.expiresAt) - now) / 1000)) : 0
  const approveUrl = request ? `${window.location.origin}/app-login#${new URLSearchParams({ approve: request.code }).toString()}` : ''
  const renew = () => { setRequest(null); setError(null); setAttempt((value) => value + 1) }

  return (
    <div className="qr-login">
      <p className="lead" style={{ margin: 0 }}>Отсканируйте QR-код телефоном, на котором открыто приложение Tarkov Operator с вашим аккаунтом, или введите код в приложении для Windows.</p>
      {error !== null && <Notice tone={error instanceof ApiError && error.network ? 'offline' : 'error'}>{errorMessage(error)}</Notice>}
      {request ? (
        <>
          <div className={`qr-login-frame${expired ? ' is-expired' : ''}`}><LoginQr value={approveUrl} label="QR-код для входа" /></div>
          <div className="qr-login-code" aria-label="Код для приложения">{request.code}</div>
          <div className="qr-login-timer">{expired ? 'Код истёк' : `Код действует ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · ждём подтверждения…`}</div>
        </>
      ) : error === null && <LoaderCircle className="spinner" aria-hidden="true" />}
      {(expired || error !== null) && <button type="button" className="button primary block" onClick={renew}><RefreshCw aria-hidden="true" />Новый QR-код</button>}
      <ol className="qr-login-steps">
        <li>Телефон: наведите камеру на QR-код и нажмите «Открыть в приложении», затем «Разрешить вход».</li>
        <li>Компьютер: приложение Tarkov Operator → Профиль оператора → «Подтвердить вход на сайте» → введите код.</li>
      </ol>
      <button type="button" className="button ghost block" onClick={onBack}><LogIn aria-hidden="true" />Войти по e-mail и паролю</button>
    </div>
  )
}
