import { useEffect, useState, type FormEvent } from 'react'
import { Copy, ExternalLink, Globe, HardDrive, LogIn, LogOut, RefreshCw, Server, UserPlus } from 'lucide-react'
import type { LocalServerStatus, TunnelStatus } from '../electron'
import { uiText } from '../i18n/renderText'
import { ACCOUNT_URL, REGISTER_URL } from '../shared/links'
import { useServerAccount } from '../sync/serverSync'

/** Opens a website page in the system browser (desktop) or a new tab (browser build). */
function openWebsite(page: 'register' | 'cabinet') {
  const desktop = window.tarkovDesktop?.account
  if (desktop) { void desktop.openWebsite(page).catch(() => false); return }
  window.open(page === 'register' ? REGISTER_URL : ACCOUNT_URL, '_blank', 'noopener,noreferrer')
}

/**
 * «Аккаунт сервера»: sign in to the owner's API server with the website account. The password goes straight to
 * the main process and on to the server; the session token never reaches this page.
 */
export function ServerAccountPanel() {
  const { status, checking, available, refresh, login, logout } = useServerAccount()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await login(email, password)
      setPassword('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Сервер недоступен')
    } finally {
      setBusy(false)
    }
  }

  const online = status?.online ?? false
  const connectionTag = !status
    ? <span className="tag">{uiText('Проверяем сервер…')}</span>
    : online
      ? <span className="tag green">{uiText('Сервер доступен')}</span>
      : <span className="tag danger">{uiText('Сервер недоступен')}</span>

  return (
    <section className="panel" style={{ marginTop: 14 }} aria-label={uiText('Аккаунт сервера')}>
      <div className="panel-header">
        <div className="panel-title"><Server size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Аккаунт сервера')}</div>
        {available && connectionTag}
      </div>
      <div className="panel-body stack">
        {!available && <p className="dim" style={{ margin: 0 }}>{uiText('Вход в аккаунт сервера доступен в приложении для Windows.')}</p>}
        {available && <LocalServerRow onChange={() => void refresh()} />}
        {available && status && <ServerAddressRow current={status.serverUrl} onChange={() => void refresh()} />}

        {available && status?.signedIn && (
          <>
            <div className="setting-row">
              <span><strong>{status.email ?? '—'}</strong><small>{uiText('Вход выполнен')}</small></span>
              <span className={`tag ${status.kind === 'streamer' ? 'brass' : ''}`}>{uiText(status.kind === 'streamer' ? 'Стример' : 'Пользователь')}</span>
            </div>
            <p className="dim" style={{ margin: 0 }}>{uiText(online
              ? 'Прогресс заданий, Коллекционер, позиция и настройки сохраняются на сервере отдельно для PvP, PvE и Сезона.'
              : 'Сервер недоступен: приложение работает локально и отправит изменения, когда сервер снова запустится.')}</p>
            {!status.persistent && <p className="dim" style={{ margin: 0 }}>{uiText('В системе нет защищённого хранилища: вход сохранится только до закрытия приложения.')}</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="button ghost" onClick={() => openWebsite('cabinet')}><ExternalLink size={14} />{uiText('Личный кабинет')}</button>
              <button className="button ghost" onClick={() => void refresh()} disabled={checking}><RefreshCw size={14} className={checking ? 'spin' : ''} />{uiText('Проверить')}</button>
              <button className="button danger" onClick={() => void logout()}><LogOut size={14} />{uiText('Выйти')}</button>
            </div>
          </>
        )}

        {available && status && !status.signedIn && (
          <form className="stack" onSubmit={(event) => void submit(event)}>
            <p className="dim" style={{ margin: 0 }}>{uiText('Войдите тем же e-mail и паролем, что на сайте. Без входа приложение работает только на этом компьютере.')}</p>
            <label className="field-label">{uiText('E-mail')}
              <input className="input" type="email" autoComplete="username" value={email} maxLength={254} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label className="field-label">{uiText('Пароль')}
              <input className="input" type="password" autoComplete="current-password" value={password} minLength={8} maxLength={128} onChange={(event) => setPassword(event.target.value)} required />
            </label>
            {error && <p className="dim" role="alert" style={{ margin: 0, color: 'var(--danger)' }}>{uiText(error)}</p>}
            {!online && <p className="dim" style={{ margin: 0 }}>{uiText('Сервер недоступен: включите «Сервер и сайт на этом компьютере» выше или запустите сервер другим способом.')}</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="button primary" type="submit" disabled={busy || !online}><LogIn size={14} />{uiText(busy ? 'Входим…' : 'Войти')}</button>
              <button className="button ghost" type="button" onClick={() => openWebsite('register')}><UserPlus size={14} />{uiText('Регистрация на сайте')}</button>
              <button className="button ghost" type="button" onClick={() => void refresh()} disabled={checking}><RefreshCw size={14} className={checking ? 'spin' : ''} />{uiText('Проверить')}</button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}

const SERVICE_LABEL: Record<LocalServerStatus['api'], string> = { running: 'работает', external: 'уже запущен отдельно', stopped: 'выключен', error: 'ошибка' }

/**
 * «Сервер и сайт на этом компьютере»: the owner runs the account API and the website from this app — no Node.js
 * or repository needed. Off by default, so a copy of the exe given to someone else stays a plain app.
 */
export function LocalServerRow({ onChange }: { onChange: () => void }) {
  const api = window.tarkovDesktop?.account
  const [local, setLocal] = useState<LocalServerStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!api?.localServerStatus) return
    const load = () => void api.localServerStatus?.().then(setLocal).catch(() => {})
    load()
    const timer = window.setInterval(load, 4000)
    return () => window.clearInterval(timer)
  }, [api])

  if (!api?.setLocalServerEnabled || !local) return null
  const toggle = async () => {
    setBusy(true)
    try {
      setLocal(await api.setLocalServerEnabled!(!local.enabled))
      onChange()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="setting-row">
        <span>
          <strong><HardDrive size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Сервер и сайт на этом компьютере')}</strong>
          <small>{uiText('Приложение само запускает сервер аккаунтов и сайт с личным кабинетом, пока оно открыто. Включайте только на своём компьютере.')}</small>
        </span>
        <button className={`toggle ${local.enabled ? 'on' : ''}`} disabled={busy} aria-pressed={local.enabled} aria-label={uiText('Сервер и сайт на этом компьютере')} onClick={() => void toggle()}><span /></button>
      </div>
      {local.enabled && (
        <div className="setting-row">
          <span>
            <small>{uiText('Сервер:')} {uiText(SERVICE_LABEL[local.api])} · {uiText('сайт:')} {uiText(SERVICE_LABEL[local.site])}</small>
            {local.error && <small style={{ color: 'var(--danger)' }}>{uiText(local.error)}</small>}
          </span>
          <button className="button ghost" onClick={() => openWebsite('cabinet')}><ExternalLink size={14} />{uiText('Открыть сайт')}</button>
        </div>
      )}
      {local.enabled && <TunnelRow />}
    </div>
  )
}

const TUNNEL_LABEL: Record<TunnelStatus['state'], string> = { off: 'выключено', downloading: 'скачиваю cloudflared…', starting: 'получаю ссылку…', on: 'работает', error: 'ошибка' }

/** «Открыть сайт друзьям»: a public https link to this PC's site and server (Cloudflare quick tunnel). */
function TunnelRow() {
  const api = window.tarkovDesktop?.account
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!api?.tunnelStatus) return
    const load = () => void api.tunnelStatus?.().then(setTunnel).catch(() => {})
    load()
    const timer = window.setInterval(load, 1500)
    return () => window.clearInterval(timer)
  }, [api])
  if (!api?.setTunnel || !tunnel) return null
  const on = tunnel.state !== 'off' && tunnel.state !== 'error'
  const copy = () => {
    if (!tunnel.url) return
    void navigator.clipboard.writeText(tunnel.url).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) })
  }
  return (
    <>
      <div className="setting-row">
        <span>
          <strong><Globe size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Открыть сайт друзьям')}</strong>
          <small>{uiText(tunnel.hostname
            ? 'Постоянный адрес через ваш аккаунт Cloudflare: друзья откроют сайт и подключат к серверу своё приложение. Работает, пока этот компьютер включён. Включённый режим запоминается.'
            : 'Бесплатная ссылка через интернет (Cloudflare): друзья откроют сайт и подключат к серверу своё приложение. Работает, пока этот компьютер включён; при каждом запуске ссылка новая. Включённый режим запоминается.')}</small>
        </span>
        <button className={`toggle ${on ? 'on' : ''}`} aria-pressed={on} aria-label={uiText('Открыть сайт друзьям')} onClick={() => void api.setTunnel!(!on).then(setTunnel)}><span /></button>
      </div>
      {tunnel.state !== 'off' && (
        <div className="setting-row">
          <span>
            <small>{uiText('Ссылка:')} {uiText(TUNNEL_LABEL[tunnel.state])}</small>
            {tunnel.url && <strong style={{ userSelect: 'text' }}>{tunnel.url}</strong>}
            {tunnel.error && <small style={{ color: 'var(--danger)' }}>{uiText(tunnel.error)}</small>}
          </span>
          {tunnel.url && <button className="button ghost" onClick={copy}><Copy size={14} />{uiText(copied ? 'Скопировано' : 'Скопировать')}</button>}
        </div>
      )}
      <NamedTunnelRow hostname={tunnel.hostname} onChange={setTunnel} />
    </>
  )
}

/** Permanent address: a named tunnel from the owner's Cloudflare account (docs/laptop-server.md). */
function NamedTunnelRow({ hostname, onChange }: { hostname?: string; onChange: (status: TunnelStatus) => void }) {
  const api = window.tarkovDesktop?.account
  const [open, setOpen] = useState(false)
  const [host, setHost] = useState(hostname ?? '')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!api?.setNamedTunnel) return null
  const apply = (nextHost: string, nextToken: string) => {
    setBusy(true); setError('')
    void api.setNamedTunnel!(nextHost, nextToken)
      .then((status) => { onChange(status); setToken(''); setOpen(false); if (!nextHost) setHost('') })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(reason)))
      .finally(() => setBusy(false))
  }
  return (
    <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span>
          <strong>{uiText('Постоянный адрес')}</strong>
          <small>{hostname ? `https://${hostname}` : uiText('Не задан: ссылка меняется при каждом запуске.')}</small>
        </span>
        <span style={{ display: 'flex', gap: 8 }}>
          {hostname && !open && <button className="button ghost" disabled={busy} onClick={() => apply('', '')}>{uiText('Убрать')}</button>}
          <button className="button ghost" onClick={() => setOpen(!open)}>{uiText(open ? 'Отмена' : hostname ? 'Изменить' : 'Настроить')}</button>
        </span>
      </div>
      {open && (
        <form style={{ display: 'grid', gap: 8 }} onSubmit={(event) => { event.preventDefault(); apply(host, token) }}>
          <small>{uiText('В панели Cloudflare создайте туннель, добавьте публичный адрес на ваш домен с сервисом http://127.0.0.1:5202 и вставьте сюда адрес и токен туннеля. Токен хранится на этом компьютере в зашифрованном виде.')}</small>
          <input className="input" placeholder="tarkov.example.com" value={host} onChange={(event) => setHost(event.target.value)} autoComplete="off" spellCheck={false} />
          <input className="input" type="password" placeholder={uiText(hostname ? 'Токен (оставьте пустым, чтобы не менять)' : 'Токен туннеля (eyJ…)')} value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" spellCheck={false} />
          {error && <small style={{ color: 'var(--danger)' }}>{uiText(error)}</small>}
          <button className="button" type="submit" disabled={busy || !host.trim()}>{uiText('Сохранить')}</button>
        </form>
      )}
    </div>
  )
}

/** For a friend's copy of the app: the owner's public link as the server address; empty = this PC. */
function ServerAddressRow({ current, onChange }: { current: string; onChange: () => void }) {
  const api = window.tarkovDesktop?.account
  const isDefault = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(current)
  const [value, setValue] = useState(isDefault ? '' : current)
  const [error, setError] = useState('')
  if (!api?.setServerUrl) return null
  const save = async (next: string) => {
    setError('')
    try {
      await api.setServerUrl!(next)
      onChange()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <label className="field-label">{uiText('Адрес сервера')}
        <input className="input" value={value} placeholder={uiText('этот компьютер (по умолчанию) или ссылка https://….trycloudflare.com')} onChange={(event) => setValue(event.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="button ghost" type="button" onClick={() => void save(value)}>{uiText('Сохранить адрес')}</button>
        {!isDefault && <button className="button ghost" type="button" onClick={() => { setValue(''); void save('') }}>{uiText('Этот компьютер')}</button>}
      </div>
      {error && <small style={{ color: 'var(--danger)' }}>{uiText(error)}</small>}
    </div>
  )
}
