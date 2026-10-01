import { Check, LoaderCircle, LogIn, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { errorMessage } from '../api'
import { useAuth } from '../auth'
import { Notice } from '../components/Notice'
import { appDeepLink, describeAgent, qrLogin } from '../qrLogin'
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
 *   browser is signed in.
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

function ApproveHere({ code }: { code: string }) {
  const auth = useAuth()
  const [info, setInfo] = useState<{ agent: string; createdAt: string } | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const fallback = `${window.location.origin}/app-login#${new URLSearchParams({ approve: code }).toString()}`

  useEffect(() => {
    if (auth.status !== 'ready' || !auth.token) return
    let active = true
    qrLogin.inspect(auth.token, code).then((value) => { if (active) setInfo(value) }, (reason: unknown) => { if (active) setError(reason) })
    return () => { active = false }
  }, [auth.status, auth.token, code])

  const approve = async () => {
    if (!auth.token) return
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
    <p className="lead">Браузер на другом устройстве просит войти в аккаунт. Код <strong>{code}</strong>.</p>
    {error !== null && <Notice tone="error">{errorMessage(error)}</Notice>}
    {done ? <Notice tone="success">Браузер вошёл в ваш аккаунт. Эту страницу можно закрыть.</Notice> : <>
      <div className="app-login-actions">
        <a className="button primary large block" href={appDeepLink('approve', code, fallback)}><Smartphone aria-hidden="true" />Открыть в приложении</a>
      </div>
      {auth.status === 'ready' && auth.account && <>
        <div className="auth-divider">или здесь</div>
        {info && <div className="app-login-info"><strong>Вход запрашивает: {describeAgent(info.agent)}</strong><small>Аккаунт: {auth.account.email}</small><small>Код создан в {new Date(info.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</small></div>}
        <Notice tone="warn">Разрешайте, только если сайт открыли вы сами. Если код прислал кто-то другой, закройте страницу.</Notice>
        <button type="button" className="button large block app-login-approve" disabled={busy || !info} onClick={() => void approve()}>
          {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Check aria-hidden="true" />}Разрешить вход
        </button>
      </>}
      {auth.status !== 'ready' && <p className="auth-switch">Нет приложения? <Link to="/login">Войдите на сайте</Link> на этом телефоне и отсканируйте код ещё раз.</p>}
    </>}
  </>
}
