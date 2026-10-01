import { Check, LoaderCircle, LogIn, Smartphone } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { errorMessage } from '../api'
import { useAuth } from '../auth'
import { Notice } from '../components/Notice'
import { appDeepLink, describeAgent, describePlace, normalizeLoginCode, qrLogin, type QrRequester } from '../qrLogin'
import '../qrLogin.css'

type Target = { kind: 'login'; code: string } | { kind: 'approve'; code: string } | null

/** The QR data stays in the fragment (#…), which browsers never send to a server or in a Referer. */
function readTarget(): Target {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const login = params.get('login') ?? ''
  if (/^[A-Za-z0-9_-]{43}$/.test(login)) return { kind: 'login', code: login }
  const approve = (params.get('approve') ?? '').toUpperCase()
  if (/^[A-Z2-9]{4}-?[A-Z2-9]{4}$/.test(approve)) return { kind: 'approve', code: approve }
  return null
}

/**
 * `/app-login`: where the QR codes lead when a phone camera scans them.
 * - `#login=…` (desktop app «Войти в мобильную версию»): open the phone app, which signs in by itself; without the app,
 *   sign in on this website instead.
 * - `#approve=XXXX-XXXX` (website «Войти по QR-коду»): open the phone app to approve, or approve right here when this
 *   browser is signed in — after checking who asks and typing the code from the sign-in screen (ApproveHere).
 */
export function AppLoginPage() {
  const [target] = useState(readTarget)
  // Drop the one-time code from the address bar and the history once it is read.
  useEffect(() => { if (window.location.hash) window.history.replaceState(null, '', window.location.pathname) }, [])

  return (
    <div className="container auth-wrap page-in">
      <div className="panel auth-card">
        <div className="eyebrow">Вход по QR-коду</div>
        {target?.kind === 'login' && <SignInHere code={target.code} />}
        {target?.kind === 'approve' && <ApproveHere code={target.code} />}
        {!target && <>
          <h1>Ссылка устарела</h1>
          <Notice tone="warn">В ссылке нет кода входа или он повреждён. Создайте новый QR-код.</Notice>
          <p className="auth-switch"><Link to="/login">Войти</Link></p>
        </>}
      </div>
    </div>
  )
}

function SignInHere({ code }: { code: string }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const fallback = window.location.origin + '/login'

  const signIn = async () => {
    setBusy(true)
    setError(null)
    try {
      const { token, account } = await qrLogin.redeem(code)
      auth.adopt(token, account)
      navigate('/cabinet', { replace: true })
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  return <>
    <h1>Вход в приложение</h1>
    <p className="lead">Приложение Raid OS на компьютере прислало одноразовый код входа. Он действует 2 минуты и срабатывает один раз.</p>
    {error !== null && <Notice tone="error">{errorMessage(error)}</Notice>}
    <div className="app-login-actions">
      <a className="button primary large block" href={appDeepLink('login', code, fallback)}><Smartphone aria-hidden="true" />Открыть в приложении</a>
      <button type="button" className="button large block" disabled={busy} onClick={() => void signIn()}>
        {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <LogIn aria-hidden="true" />}Войти на сайте
      </button>
    </div>
    <p className="auth-switch">Приложения на телефоне ещё нет? Нажмите «Войти на сайте»: откроется личный кабинет.</p>
  </>
}

/**
 * Approving here never takes one click: a link with `#approve=…` may have been sent by somebody who wants into this
 * account. The page shows who / where / when asks, warns, and approves only after the person types the code shown on
 * the screen they are signing in on (it must equal the link's code; the page itself never shows it).
 */
function ApproveHere({ code }: { code: string }) {
  const auth = useAuth()
  const [info, setInfo] = useState<QrRequester | null>(null)
  const [typed, setTyped] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const fallback = `${window.location.origin}/app-login#${new URLSearchParams({ approve: code }).toString()}`
  const complete = normalizeLoginCode(typed).length === 8
  const matches = complete && normalizeLoginCode(typed) === normalizeLoginCode(code)

  useEffect(() => {
    if (auth.status !== 'ready' || !auth.token) return
    let active = true
    qrLogin.inspect(auth.token, code).then((value) => { if (active) setInfo(value) }, (reason: unknown) => { if (active) setError(reason) })
    return () => { active = false }
  }, [auth.status, auth.token, code])

  const approve = async (event: FormEvent) => {
    event.preventDefault()
    if (!auth.token || !info || !matches) return
    setBusy(true)
    setError(null)
    try {
      await qrLogin.approve(auth.token, code)
      setDone(true)
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  return <>
    <h1>{done ? 'Готово' : 'Подтвердить вход'}</h1>
    <p className="lead">Браузер на другом устройстве просит войти в ваш аккаунт.</p>
    {error !== null && <Notice tone="error">{errorMessage(error)}</Notice>}
    {done ? <Notice tone="success">Браузер вошёл в ваш аккаунт. Эту страницу можно закрыть.</Notice> : <>
      <div className="app-login-actions">
        <a className="button primary large block" href={appDeepLink('approve', code, fallback)}><Smartphone aria-hidden="true" />Открыть в приложении</a>
      </div>
      {auth.status === 'ready' && auth.account && <>
        <div className="auth-divider">или здесь</div>
        {info && <div className="app-login-info">
          <strong>Вход запрашивает: {describeAgent(info.agent)}</strong>
          <small>Откуда: {describePlace(info) || 'неизвестно'}</small>
          <small>Когда: код создан в {new Date(info.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</small>
          <small>Аккаунт: {auth.account.email}</small>
        </div>}
        <Notice tone="error">Подтверждайте, только если вы сами сейчас входите на другом устройстве. Никогда не подтверждайте вход по ссылке, которую вам прислали.</Notice>
        <form className="app-login-confirm" onSubmit={(event) => void approve(event)}>
          <label className="field">
            <span className="field-label">Код с экрана, на котором вы входите</span>
            <input className="input code" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="XXXX-XXXX" maxLength={9} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          </label>
          {complete && !matches && <div className="field-hint app-login-mismatch" role="alert">Код не совпадает. Введите код, который показан под QR-кодом на экране, где вы входите.</div>}
          <button type="submit" className="button large block app-login-approve" disabled={busy || !info || !matches}>
            {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Check aria-hidden="true" />}Подтвердить
          </button>
        </form>
      </>}
      {auth.status !== 'ready' && <p className="auth-switch">Нет приложения? <Link to="/login">Войдите на сайте</Link> на этом телефоне и отсканируйте код ещё раз.</p>}
    </>}
  </>
}
