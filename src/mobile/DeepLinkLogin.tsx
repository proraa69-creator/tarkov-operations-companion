import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { AlertTriangle, Check, Globe, LoaderCircle, LogIn, ShieldAlert, Smartphone, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { isNative } from '../platform'
import { cleanIpcError, refreshServerStatus, useServerAccount } from '../sync/serverSync'
import { apiBaseUrl, DEFAULT_API_URL, normalizeApiUrl, setApiBaseUrl, webAccountRedeemLoginCode, webServiceRequest } from '../sync/webAccount'
import { parseAccountDeepLink, type AccountDeepLink } from './deepLink'
import '../account/account.css'

const host = (url: string) => { try { return new URL(url).host } catch { return url } }

/** A sign-in link may switch the phone without asking only to the server it already uses or the app's built-in one. */
function isKnownServer(server: string) {
  return [apiBaseUrl(), DEFAULT_API_URL].some((known) => { try { return normalizeApiUrl(known) === server } catch { return false } })
}

/**
 * Phone app: QR sign-in links (mobile/deepLink.ts). A desktop QR signs the phone in to the same account; a website QR
 * asks the signed-in phone to approve a browser sign-in. Each asks first and shows the server it goes to.
 */
export function DeepLinkLogin() {
  const [link, setLink] = useState<AccountDeepLink | null>(null)

  useEffect(() => {
    if (!isNative()) return
    const open = (url?: string) => { const parsed = url ? parseAccountDeepLink(url) : null; if (parsed) setLink(parsed) }
    void CapacitorApp.getLaunchUrl().then((launch) => open(launch?.url)).catch(() => {})
    const handle = CapacitorApp.addListener('appUrlOpen', (event) => open(event.url))
    return () => { void handle.then((listener) => listener.remove()).catch(() => {}) }
  }, [])

  if (!link) return null
  return link.kind === 'login'
    ? <PhoneSignIn link={link} onClose={() => setLink(null)} />
    : <PhoneApprove link={link} onClose={() => setLink(null)} />
}

function Frame({ label, icon, onClose, children }: { label: string; icon: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="registration-overlay" role="dialog" aria-modal="true" aria-label={label}>
      <section className="panel registration-dialog account-qr-dialog">
        <button className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        <div className="registration-icon">{icon}</div>
        {children}
      </section>
    </div>
  )
}

function PhoneSignIn({ link, onClose }: { link: Extract<AccountDeepLink, { kind: 'login' }>; onClose: () => void }) {
  const { status } = useServerAccount()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  /** The other server the user agreed to in the confirmation below (tied to that exact address). */
  const [confirmedServer, setConfirmedServer] = useState('')
  let server = ''
  let serverError = ''
  try { server = normalizeApiUrl(link.server || apiBaseUrl()) } catch (reason) { serverError = reason instanceof Error ? reason.message : 'Некорректный адрес сервера' }
  const switching = Boolean(status?.signedIn && server && host(server) !== host(apiBaseUrl()))
  const unknownServer = Boolean(server) && confirmedServer !== server && !isKnownServer(server)

  const signIn = useCallback(() => {
    if (!server) return
    setBusy(true)
    setError('')
    const previous = apiBaseUrl()
    try { setApiBaseUrl(server) } catch (reason) { setError(cleanIpcError(reason)); setBusy(false); return }
    void webAccountRedeemLoginCode(link.code).then((next) => { setEmail(next.email ?? ''); void refreshServerStatus() }, (reason: unknown) => {
      setApiBaseUrl(previous)
      setError(cleanIpcError(reason))
    }).finally(() => setBusy(false))
  }, [link.code, server])

  // Not the server the phone uses, nor the built-in one: a link from someone else could move the account elsewhere.
  if (unknownServer) {
    return (
      <Frame label={uiText('Незнакомый сервер')} icon={<ShieldAlert size={28} />} onClose={onClose}>
        <div className="eyebrow">{uiText('Вход по QR-коду')}</div>
        <h2>{uiText('Незнакомый сервер')}</h2>
        <p className="muted">{uiText('Ссылка для входа ведёт на сервер, которого нет в приложении:')}</p>
        <div className="account-server-host">{host(server)}</div>
        <small className="account-server-url">{server}</small>
        <div className="import-warning" role="alert"><AlertTriangle size={17} /><span>{uiText('Подключайтесь, только если это ваш сервер. Чужой сервер получит доступ к тому, что вы делаете в приложении, и может притвориться Raid OS. Если ссылку прислал кто-то другой, нажмите «Отмена».')}</span></div>
        <div className="account-approve-actions">
          {/* «Отмена» is the default: focused, the primary button. */}
          <button className="button primary" autoFocus onClick={onClose}>{uiText('Отмена')}</button>
          <button className="button ghost" onClick={() => setConfirmedServer(server)}>{uiText('Подключиться к этому серверу')}</button>
        </div>
      </Frame>
    )
  }

  return (
    <Frame label={uiText('Вход по QR-коду')} icon={<Smartphone size={28} />} onClose={onClose}>
      <div className="eyebrow">{uiText('Вход по QR-коду')}</div>
      <h2>{uiText(email ? 'Вы вошли' : 'Войти в аккаунт?')}</h2>
      {!email && <p className="muted">{uiText('Приложение на компьютере прислало одноразовый код входа. Телефон войдёт в тот же аккаунт на сервере')} <strong>{host(server)}</strong>.</p>}
      {switching && !email && <div className="import-warning"><AlertTriangle size={17} /><span>{uiText('Сейчас телефон подключён к другому серверу. После входа он переключится на этот.')}</span></div>}
      {email && <div className="import-note" role="status"><Check size={14} />{email}</div>}
      {(error || serverError) && <div className="import-warning" role="alert"><AlertTriangle size={17} /><span>{uiText(error || serverError)}</span></div>}
      {!email && <button className="button primary" disabled={busy || !server} onClick={signIn}>{busy ? <LoaderCircle className="spin" size={16} /> : <LogIn size={16} />}{uiText('Войти')}</button>}
      {email && <button className="button primary" onClick={onClose}>{uiText('Готово')}</button>}
    </Frame>
  )
}

function PhoneApprove({ link, onClose }: { link: Extract<AccountDeepLink, { kind: 'approve' }>; onClose: () => void }) {
  const { status } = useServerAccount()
  const [info, setInfo] = useState<{ agent: string; createdAt: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const signedIn = Boolean(status?.signedIn)

  useEffect(() => {
    if (!signedIn) return
    void webServiceRequest('POST', '/v1/accounts/me/qr-login/inspect', { code: link.code })
      .then((answer) => setInfo(answer as { agent: string; createdAt: string }), (reason: unknown) => setError(cleanIpcError(reason)))
  }, [signedIn, link.code])

  const approve = () => {
    setBusy(true)
    setError('')
    void webServiceRequest('POST', '/v1/accounts/me/qr-login/approve', { code: link.code })
      .then(() => setDone(true), (reason: unknown) => setError(cleanIpcError(reason))).finally(() => setBusy(false))
  }

  return (
    <Frame label={uiText('Подтвердить вход на сайте')} icon={<Globe size={28} />} onClose={onClose}>
      <div className="eyebrow">{uiText('Сайт · вход по QR-коду')}</div>
      <h2>{uiText(done ? 'Готово' : 'Подтвердить вход на сайте')}</h2>
      {!signedIn && <p className="muted">{uiText('Сначала войдите в аккаунт в этом приложении (Ещё → Настройки), затем отсканируйте QR-код ещё раз.')}</p>}
      {signedIn && !done && <p className="muted">{uiText('Браузер просит войти в ваш аккаунт')} {status?.email} · {uiText('код')} {link.code}</p>}
      {info && !done && <div className="account-approve-info"><strong>{info.agent.slice(0, 80) || uiText('Браузер')}</strong><small>{uiText('Код создан в')} {new Date(info.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</small></div>}
      {signedIn && !done && <div className="import-warning"><AlertTriangle size={17} /><span>{uiText('Разрешайте, только если сайт открыли вы сами. Если код прислал кто-то другой, нажмите «Отмена».')}</span></div>}
      {done && <div className="import-note" role="status"><Check size={14} />{uiText('Готово: браузер вошёл в ваш аккаунт.')}</div>}
      {error && <div className="import-warning" role="alert"><AlertTriangle size={17} /><span>{uiText(error)}</span></div>}
      {signedIn && !done && info && (
        <div className="account-approve-actions">
          <button className="button ghost" onClick={onClose}>{uiText('Отмена')}</button>
          <button className="button primary" disabled={busy} onClick={approve}>{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{uiText('Разрешить вход')}</button>
        </div>
      )}
      {(done || !signedIn) && <button className="button primary" onClick={onClose}>{uiText('Закрыть')}</button>}
    </Frame>
  )
}
