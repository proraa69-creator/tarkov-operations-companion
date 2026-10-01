import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { AlertTriangle, Check, Globe, LoaderCircle, LogIn, ShieldAlert, Smartphone, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { isNative } from '../platform'
import { cleanIpcError, refreshServerStatus, useServerAccount } from '../sync/serverSync'
import { apiBaseUrl, DEFAULT_API_URL, normalizeApiUrl, setApiBaseUrl, webAccountRedeemLoginCode, webServiceRequest } from '../sync/webAccount'
import { parseAccountDeepLink, type AccountDeepLink } from './deepLink'
import { describeAgent, describePlace, normalizeLoginCode, type Inspected } from '../account/qrInspect'
import { useLocale } from '../i18n/LocaleProvider'
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
    <div className="registration-overlay account-deeplink" role="dialog" aria-modal="true" aria-label={label}>
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

/**
 * Website «Войти по QR-коду» scanned with the phone: the link carries the code, so a link somebody sent would sign their
 * browser in with one tap. The phone therefore shows who asks and from where, and approves only after the person types
 * the code shown on the screen they are signing in on (it must equal the link's code).
 */
function PhoneApprove({ link, onClose }: { link: Extract<AccountDeepLink, { kind: 'approve' }>; onClose: () => void }) {
  const { status } = useServerAccount()
  const { locale } = useLocale()
  const [info, setInfo] = useState<Inspected | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const signedIn = Boolean(status?.signedIn)
  const complete = normalizeLoginCode(typed).length === 8
  const matches = complete && normalizeLoginCode(typed) === normalizeLoginCode(link.code)

  useEffect(() => {
    if (!signedIn) return
    void webServiceRequest('POST', '/v1/accounts/me/qr-login/inspect', { code: link.code })
      .then((answer) => setInfo(answer as Inspected), (reason: unknown) => setError(cleanIpcError(reason)))
  }, [signedIn, link.code])

  const approve = () => {
    if (!matches) return
    setBusy(true)
    setError('')
    void webServiceRequest('POST', '/v1/accounts/me/qr-login/approve', { code: link.code })
      .then(() => setDone(true), (reason: unknown) => setError(cleanIpcError(reason))).finally(() => setBusy(false))
  }

  const place = info ? describePlace(info, locale) : ''
  return (
    <Frame label={uiText('Подтвердить вход на сайте')} icon={<Globe size={28} />} onClose={onClose}>
      <div className="eyebrow">{uiText('Сайт · вход по QR-коду')}</div>
      <h2>{uiText(done ? 'Готово' : 'Подтвердить вход на сайте')}</h2>
      {!signedIn && <p className="muted">{uiText('Сначала войдите в аккаунт в этом приложении (Ещё → Настройки), затем отсканируйте QR-код ещё раз.')}</p>}
      {signedIn && !done && <p className="muted">{uiText('Браузер просит войти в ваш аккаунт')} {status?.email}</p>}
      {info && !done && (
        <div className="account-approve-info">
          <strong>{describeAgent(info.agent)}</strong>
          <small>{uiText('Откуда:')} {place || uiText('неизвестно')}</small>
          <small>{uiText('Код создан в')} {new Date(info.createdAt).toLocaleTimeString(locale === 'en' ? 'en-GB' : 'ru-RU', { hour: '2-digit', minute: '2-digit' })}</small>
        </div>
      )}
      {signedIn && !done && <div className="import-warning"><AlertTriangle size={17} /><span>{uiText('Подтверждайте, только если вы сами сейчас входите на другом устройстве. Никогда не подтверждайте вход по ссылке, которую вам прислали.')}</span></div>}
      {signedIn && !done && info && (
        <label className="field">
          <span>{uiText('Код с экрана, на котором вы входите')}</span>
          <input className="input code" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="XXXX-XXXX" maxLength={9} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        </label>
      )}
      {signedIn && !done && complete && !matches && <div className="import-warning" role="alert"><AlertTriangle size={17} /><span>{uiText('Код не совпадает. Введите код, который показан под QR-кодом на экране, где вы входите.')}</span></div>}
      {done && <div className="import-note" role="status"><Check size={14} />{uiText('Готово: браузер вошёл в ваш аккаунт.')}</div>}
      {error && <div className="import-warning" role="alert"><AlertTriangle size={17} /><span>{uiText(error)}</span></div>}
      {signedIn && !done && info && (
        <div className="account-approve-actions">
          <button className="button ghost" onClick={onClose}>{uiText('Отмена')}</button>
          <button className="button primary" disabled={busy || !matches} onClick={approve}>{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{uiText('Разрешить вход')}</button>
        </div>
      )}
      {(done || !signedIn) && <button className="button primary" onClick={onClose}>{uiText('Закрыть')}</button>}
    </Frame>
  )
}
