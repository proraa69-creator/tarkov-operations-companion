import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { LoaderCircle, LogIn, LogOut, RefreshCw, Server, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ServerAccountStatus } from '../electron.d'
import { webAdminAccountLogin, webAdminAccountLogout, webAdminAccountStatus } from '../sync/webAccount'
import { AdminMobilePage } from './AdminMobilePage'
import { useAdminNotifications } from './useAdminNotifications'
import './adminStandalone.css'

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Сервер недоступен'
}

export function AdminStandaloneApp() {
  const [status, setStatus] = useState<ServerAccountStatus | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const owner = status?.signedIn === true && status.owner === true
  useAdminNotifications(owner)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try { setStatus(await webAdminAccountStatus()) }
    catch (reason) { setError(message(reason)) }
    finally { setRefreshing(false) }
  }, [])

  useEffect(() => {
    let active = true
    webAdminAccountStatus()
      .then((next) => { if (active) setStatus(next) })
      .catch((reason) => { if (active) setError(message(reason)) })
    return () => { active = false }
  }, [])

  if (!status && !error) return <AdminSplash />
  if (!status?.signedIn) return <AdminLogin offline={status?.online === false} initialError={error} onSignedIn={setStatus} onRetry={refresh} refreshing={refreshing} />
  if (!owner) return <AdminDenied status={status} onLogout={async () => setStatus(await webAdminAccountLogout())} />

  return <div className="admin-standalone-shell">
    <div className="admin-standalone-session">
      <span><span className={`admin-server-dot${status.online ? '' : ' offline'}`} />{status.online ? 'Сервер подключён' : 'Нет связи с сервером'}</span>
      <strong>{status.email}</strong>
      <button type="button" onClick={async () => setStatus(await webAdminAccountLogout())}><LogOut size={15} />Выйти</button>
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
