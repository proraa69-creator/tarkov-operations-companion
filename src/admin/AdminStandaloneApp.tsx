import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, LogIn, LogOut, RefreshCw, Server, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ServerAccountStatus } from '../electron.d'
import { webAdminAccountLogin, webAdminAccountLogout, webAdminAccountStatus, webStoredSessionEmail } from '../sync/webAccount'
import { AdminMobilePage } from './AdminMobilePage'
import { useAdminNotifications } from './useAdminNotifications'
import './adminStandalone.css'

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Сервер недоступен'
}

/** The owner's e-mail the server last confirmed on this phone: the panel opens with it before the server answers. */
const OWNER_KEY = 'raidos.admin.confirmedOwner'
const readOwner = () => { try { return localStorage.getItem(OWNER_KEY) } catch { return null } }
const writeOwner = (email: string | null) => { try { if (email) localStorage.setItem(OWNER_KEY, email); else localStorage.removeItem(OWNER_KEY) } catch { /* asked again next time */ } }
/** Waits between checks while the server does not answer: 5 s, 10 s, 20 s, then every 30 s. */
const RETRY_MS = [5_000, 10_000, 20_000, 30_000]

/**
 * The owner's iPhone admin app (owner, 30.10.2026: «постоянно тупит аккаунт и пишет нет связи с сервером… я должен
 * нажать на приложение и у меня сразу открылось все. без входа»): with the owner's session kept on the phone the panel
 * opens at once and the server is checked in the background — again and again while it does not answer, and every time
 * the app comes back to the screen. A slow or absent network never signs out and never shows «Доступ закрыт»: only the
 * server's own answer does (the session ended, or the account is not the owner's). The server keeps the owner's
 * session alive while it is used (server/src/services/accountStore.ts OWNER_SESSION_TTL_MS).
 */
export function AdminStandaloneApp() {
  const [status, setStatus] = useState<ServerAccountStatus | null>(() => {
    const email = webStoredSessionEmail()
    return email && readOwner() === email ? { signedIn: true, email, owner: true, online: false, persistent: true } as ServerAccountStatus : null
  })
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  // Every change starts one check of the server (the start, a retry, the app back on the screen, «Повторить»).
  const [attempt, setAttempt] = useState(0)
  const failures = useRef(0)
  const owner = status?.signedIn === true && status.owner === true
  useAdminNotifications(owner)

  const accept = useCallback((next: ServerAccountStatus) => {
    setStatus((previous) => {
      // No answer from the server: keep what the phone knows (the session stays, the owner stays the owner).
      if (!next.online && previous?.signedIn && next.signedIn) return { ...previous, online: false }
      return next
    })
    if (next.online && next.signedIn && next.email) writeOwner(next.owner === true ? next.email : null)
    if (next.online && !next.signedIn) writeOwner(null)
  }, [])

  useEffect(() => {
    let active = true
    let timer: number | null = null
    webAdminAccountStatus().then(
      (next) => {
        if (!active) return
        accept(next)
        setError('')
        failures.current = next.online ? 0 : failures.current + 1
      },
      (reason: unknown) => {
        if (!active) return
        setError(message(reason))
        failures.current += 1
      },
    ).finally(() => {
      if (!active) return
      setRefreshing(false)
      setChecking(false)
      // No answer: again after a while, longer each time.
      if (failures.current > 0) timer = window.setTimeout(() => setAttempt((value) => value + 1), RETRY_MS[Math.min(failures.current, RETRY_MS.length) - 1])
    })
    return () => {
      active = false
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [attempt, accept])

  useEffect(() => {
    // Back on the screen (from the background or another app) or back online: check again at once.
    const onVisible = () => { if (document.visibilityState === 'visible') setAttempt((value) => value + 1) }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [])
  const check = () => { setRefreshing(true); setAttempt((value) => value + 1) }

  const logout = async () => { writeOwner(null); setStatus(await webAdminAccountLogout()) }

  if (!status && checking) return <AdminSplash />
  if (!status?.signedIn) return <AdminLogin offline={status?.online === false} initialError={error} onSignedIn={accept} onRetry={check} refreshing={refreshing} />
  // Not the owner only by the server's answer; without one the splash waits for the next check.
  if (!owner) return status.online ? <AdminDenied status={status} onLogout={logout} /> : <AdminSplash />

  return <div className="admin-standalone-shell">
    <div className="admin-standalone-session">
      <span><span className={`admin-server-dot${status.online ? '' : ' offline'}`} />{status.online ? 'Сервер подключён' : checking || refreshing ? 'Подключаемся…' : 'Нет связи — повторяем'}</span>
      <strong>{status.email}</strong>
      {!status.online && <button type="button" onClick={check} disabled={refreshing}><RefreshCw size={15} className={refreshing ? 'spin' : ''} />Повторить</button>}
      <button type="button" onClick={() => void logout()}><LogOut size={15} />Выйти</button>
    </div>
    <AdminMobilePage />
  </div>
}

function AdminSplash() {
  return <main className="admin-auth-page" aria-label="Загрузка"><section className="admin-auth-card admin-splash-card"><div className="admin-auth-mark"><ShieldCheck size={32} /></div><h1>Админ панель</h1><p>Подключаемся к серверу Raid OS</p><LoaderCircle className="spin" size={22} /></section></main>
}

function AdminLogin({ offline, initialError, onSignedIn, onRetry, refreshing }: {
  offline: boolean; initialError: string; onSignedIn: (status: ServerAccountStatus) => void; onRetry: () => void; refreshing: boolean
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try { onSignedIn(await webAdminAccountLogin(email, password)); setPassword('') }
    catch (reason) { setError(message(reason)) }
    finally { setBusy(false) }
  }

  return <main className="admin-auth-page">
    <section className="admin-auth-card">
      <div className="admin-auth-mark"><ShieldCheck size={32} /></div>
      <div className="admin-auth-copy"><span>RAID OS</span><h1>Админ панель</h1><p>Прямое защищённое подключение к серверу. Подписка для входа не требуется.</p></div>
      {offline && <div className="admin-auth-warning"><Server size={17} /><span>Сервер сейчас недоступен</span><button type="button" onClick={onRetry} disabled={refreshing}><RefreshCw size={15} className={refreshing ? 'spin' : ''} />Повторить</button></div>}
      <form className="admin-auth-form" onSubmit={(event) => void submit(event)}>
        <label><span>E-mail владельца</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label><span>Пароль</span><input type="password" autoComplete="current-password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <div className="admin-auth-error" role="alert"><ShieldAlert size={17} />{error}</div>}
        <button className="admin-auth-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <LogIn size={18} />}{busy ? 'Подключаемся…' : 'Войти'}</button>
      </form>
      <small className="admin-auth-footnote">Доступ получит только аккаунт владельца, подтверждённый сервером.</small>
    </section>
  </main>
}

function AdminDenied({ status, onLogout }: { status: ServerAccountStatus; onLogout: () => Promise<void> }) {
  return <main className="admin-auth-page"><section className="admin-auth-card admin-denied-card"><div className="admin-auth-mark danger"><ShieldAlert size={32} /></div><h1>Доступ закрыт</h1><p>Аккаунт <strong>{status.email}</strong> не является аккаунтом владельца.</p><button className="admin-auth-submit" type="button" onClick={() => void onLogout()}><LogOut size={18} />Войти другим аккаунтом</button></section></main>
}
