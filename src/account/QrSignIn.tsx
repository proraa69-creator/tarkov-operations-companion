import { useEffect, useState } from 'react'
import { AlertTriangle, Camera, ExternalLink, LoaderCircle, LogIn, Monitor, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react'
import type { ServerAccountStatus } from '../electron'
import { uiText } from '../i18n/renderText'
import { QrCode } from '../components/QrCode'
import { cleanIpcError, useServerAccount } from '../sync/serverSync'
import { webAccountQrPoll, webAccountQrStart } from '../sync/webAccount'
import { openAccountLink } from '../mobile/deepLink'
import { QrScanner } from '../mobile/QrScanner'
import './account.css'

const POLL_MS = 2000

/**
 * «Войти по QR-коду» on the sign-in screen (owner, 28.10.2026). Either way the device that already has the account
 * confirms the one being signed in:
 * - the PC app shows a one-time code as a QR code; the phone app signed in to the account scans it with the camera and
 *   approves (mobile/DeepLinkLogin.tsx PhoneApprove), and this PC signs in by itself (electron/serviceGateway.ts);
 * - the phone app explains the other way: the PC app signed in → Профиль → «Войти в мобильную версию», then the camera.
 */
export function QrSignIn({ onSignedIn, onBack, google = false }: { onSignedIn: (next: ServerAccountStatus) => void; onBack: () => void; google?: boolean }) {
  const desktop = Boolean(window.tarkovDesktop?.account?.qrStart)
  if (desktop) return <DesktopQrSignIn onSignedIn={onSignedIn} onBack={onBack} google={google} />
  return google ? <PhoneGoogleSignIn onSignedIn={onSignedIn} onBack={onBack} /> : <PhoneQrSteps onBack={onBack} />
}

/**
 * `google`: «Войти через Google» on the PC (owner, 15.11.2026: «для всех стран, кроме России»). The same one-time request,
 * but its page opens in the browser: the player signs in with Google there (website pages/AppLoginPage.tsx), types the code
 * shown here and confirms — this PC then signs in by itself, as with the phone.
 */
function DesktopQrSignIn({ onSignedIn, onBack, google }: { onSignedIn: (next: ServerAccountStatus) => void; onBack: () => void; google: boolean }) {
  const api = window.tarkovDesktop?.account
  const { refresh } = useServerAccount()
  const [request, setRequest] = useState<{ code: string; expiresAt: string; url: string } | null>(null)
  const [expired, setExpired] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!api?.qrStart) return
    let active = true
    api.qrStart().then((value) => { if (active) { setRequest(value); setExpired(false); setError('') } }, (reason: unknown) => { if (active) setError(cleanIpcError(reason)) })
    return () => { active = false }
  }, [api, attempt])

  // The browser opens once per code (a new code opens it again).
  useEffect(() => { if (google && request) window.open(request.url, '_blank', 'noopener') }, [google, request])

  useEffect(() => {
    if (!request || expired || !api?.qrPoll) return
    let active = true
    let timer = 0
    const tick = async () => {
      if (!active) return
      setNow(Date.now())
      try {
        const answer = await api.qrPoll!()
        if (!active) return
        if (answer.state === 'done') { await refresh().catch(() => undefined); onSignedIn(answer.status); return }
        if (answer.state === 'expired' || Date.parse(request.expiresAt) <= Date.now()) { setExpired(true); return }
      } catch {
        // A lost connection for a moment: the next look tries again until the code runs out.
        if (Date.parse(request.expiresAt) <= Date.now()) { setExpired(true); return }
      }
      timer = window.setTimeout(() => void tick(), POLL_MS)
    }
    timer = window.setTimeout(() => void tick(), POLL_MS)
    return () => { active = false; window.clearTimeout(timer) }
  }, [request, expired, api, refresh, onSignedIn])

  const left = request ? Math.max(0, Math.round((Date.parse(request.expiresAt) - now) / 1000)) : 0
  const renew = () => { setRequest(null); setError(''); setAttempt((value) => value + 1) }
  return (
    <div className="stack account-qr-signin">
      <h2>{uiText(google ? 'Вход через Google' : 'Вход по QR-коду')}</h2>
      <p className="muted">{uiText(google
        ? 'В браузере войдите через Google, введите код с этого экрана и нажмите «Подтвердить» — компьютер войдёт сам.'
        : 'Наведите камеру телефона, где открыт Raid OS с вашим аккаунтом, на QR-код. В приложении введите код с этого экрана и нажмите «Разрешить вход» — компьютер войдёт сам.')}</p>
      {!google && request && <div className={`account-qr-frame${expired ? ' is-expired' : ''}`}><QrCode value={request.url} label={uiText('QR-код для входа')} /></div>}
      {!request && !error && <div className="account-qr-frame"><LoaderCircle className="spin" size={40} color="#333" /></div>}
      {request && <div className="account-qr-code" aria-label={uiText('Код для телефона')}>{request.code}</div>}
      {request && <div className="account-qr-timer">{expired ? uiText('Код истёк') : `${uiText(google ? 'Ждём подтверждения в браузере' : 'Ждём подтверждения с телефона')} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</div>}
      {google && request && !expired && <button type="button" className="button ghost" onClick={() => window.open(request.url, '_blank', 'noopener')}><ExternalLink size={15} />{uiText('Открыть сайт ещё раз')}</button>}
      {error && <div className="import-warning" role="alert"><AlertTriangle size={17} /><span>{uiText(error)}</span></div>}
      {(expired || error) && <button type="button" className="button primary" onClick={renew}><RefreshCw size={15} />{uiText(google ? 'Новый код' : 'Новый QR-код')}</button>}
      <div className="import-note"><ShieldCheck size={14} />{uiText('В QR-коде нет пароля: только одноразовый код на 2 минуты.')}</div>
      <button type="button" className="button ghost" onClick={onBack}><LogIn size={15} />{uiText('Войти по e-mail и паролю')}</button>
    </div>
  )
}

function PhoneQrSteps({ onBack }: { onBack: () => void }) {
  // The app's own camera (owner, 25.11.2026): the QR of «Войти в мобильную версию» signs this phone in right away
  // (mobile/DeepLinkLogin.tsx PhoneSignIn asks first, as with the phone's camera).
  const [scanning, setScanning] = useState(false)
  return (
    <div className="stack account-qr-signin">
      <h2>{uiText('Вход по QR-коду')}</h2>
      {scanning
        ? <QrScanner onLink={(link) => { setScanning(false); openAccountLink(link) }} />
        : <button type="button" className="button primary" onClick={() => setScanning(true)}><Camera size={16} />{uiText('Сканировать QR-код')}</button>}
      <ol className="account-qr-steps">
        <li><Monitor size={15} /><span>{uiText('На компьютере откройте Raid OS, где вы уже вошли в аккаунт.')}</span></li>
        <li><LogIn size={15} /><span>{uiText('Профиль → «Войти в мобильную версию»: появится QR-код.')}</span></li>
        <li><Smartphone size={15} /><span>{uiText('Наведите камеру телефона на QR-код и нажмите «Открыть в приложении» — телефон войдёт сам.')}</span></li>
      </ol>
      <button type="button" className="button ghost" onClick={onBack}><LogIn size={15} />{uiText('Войти по e-mail и паролю')}</button>
    </div>
  )
}

/**
 * «Войти через Google» on the phone (owner, 25.11.2026; not in Russia: shared/googleRegion.ts and the server). As on the PC
 * (DesktopQrSignIn `google`): a one-time request, its page opens in the phone's browser, the player signs in with Google
 * there and confirms the code shown here; the app polls and signs in by itself (sync/webAccount.ts webAccountQrStart).
 */
function PhoneGoogleSignIn({ onSignedIn, onBack }: { onSignedIn: (next: ServerAccountStatus) => void; onBack: () => void }) {
  const [request, setRequest] = useState<{ code: string; expiresAt: string; url: string } | null>(null)
  const [expired, setExpired] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let active = true
    webAccountQrStart().then((value) => { if (active) { setRequest(value); setExpired(false); setError('') } }, (reason: unknown) => { if (active) setError(cleanIpcError(reason)) })
    return () => { active = false }
  }, [attempt])

  // The browser opens once per code (a new code opens it again).
  useEffect(() => { if (request) window.open(request.url, '_blank', 'noopener') }, [request])

  useEffect(() => {
    if (!request || expired) return
    let active = true
    let timer = 0
    const tick = async () => {
      if (!active) return
      setNow(Date.now())
      try {
        const answer = await webAccountQrPoll()
        if (!active) return
        if (answer.state === 'done') { onSignedIn(answer.status); return }
        if (answer.state === 'expired' || Date.parse(request.expiresAt) <= Date.now()) { setExpired(true); return }
      } catch {
        if (Date.parse(request.expiresAt) <= Date.now()) { setExpired(true); return }
      }
      timer = window.setTimeout(() => void tick(), POLL_MS)
    }
    timer = window.setTimeout(() => void tick(), POLL_MS)
    return () => { active = false; window.clearTimeout(timer) }
  }, [request, expired, onSignedIn])

  const left = request ? Math.max(0, Math.round((Date.parse(request.expiresAt) - now) / 1000)) : 0
  return (
    <div className="stack account-qr-signin">
      <h2>{uiText('Вход через Google')}</h2>
      <p className="muted">{uiText('В браузере войдите через Google, введите код с этого экрана и нажмите «Подтвердить» — приложение войдёт само.')}</p>
      {!request && !error && <div className="account-qr-frame"><LoaderCircle className="spin" size={40} color="#333" /></div>}
      {request && <div className="account-qr-code" aria-label={uiText('Код для входа')}>{request.code}</div>}
      {request && <div className="account-qr-timer">{expired ? uiText('Код истёк') : `${uiText('Ждём подтверждения в браузере')} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</div>}
      {request && !expired && <button type="button" className="button" onClick={() => window.open(request.url, '_blank', 'noopener')}><ExternalLink size={15} />{uiText('Открыть страницу входа')}</button>}
      {(expired || error) && <button type="button" className="button" onClick={() => { setRequest(null); setError(''); setAttempt((value) => value + 1) }}><RefreshCw size={15} />{uiText('Новый код')}</button>}
      {error && <div className="import-warning" role="alert"><AlertTriangle size={17} /><span>{uiText(error)}</span></div>}
      <button type="button" className="button ghost" onClick={onBack}><LogIn size={15} />{uiText('Войти по e-mail и паролю')}</button>
    </div>
  )
}
