import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, Check, Globe, LoaderCircle, QrCode as QrIcon, RefreshCw, ShieldCheck, Smartphone, X } from 'lucide-react'
import type { MobileLoginLink } from '../electron'
import { useLocale } from '../i18n/LocaleProvider'
import { describeAgent, describePlace, type Inspected } from './qrInspect'
import { uiText } from '../i18n/renderText'
import { QrCode } from '../components/QrCode'
import { cleanIpcError } from '../sync/serverSync'
import { serviceClient } from './nicknameBinding'
import './account.css'

function Overlay({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])
  return (
    <div className="registration-overlay" role="dialog" aria-modal="true" aria-label={label} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel registration-dialog account-qr-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <button className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        {children}
      </section>
    </div>
  )
}

function useCountdown(expiresAt?: string) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expiresAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt])
  const left = expiresAt ? Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000)) : 0
  return { left, text: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` }
}

/**
 * «Войти в мобильную версию»: a QR code with a two-minute one-time code (never the session token). The phone camera
 * opens the website page, which starts the phone app (tarkovoperator://login…) and the app signs in by itself.
 */
export function MobileLoginDialog({ onClose }: { onClose: () => void }) {
  const api = window.tarkovDesktop?.account
  const [link, setLink] = useState<MobileLoginLink | null>(null)
  const [error, setError] = useState(api?.mobileLogin ? '' : 'QR-код для телефона создаёт приложение для Windows.')
  const [attempt, setAttempt] = useState(0)
  const busy = !link && !error
  const { left, text } = useCountdown(link?.expiresAt)

  useEffect(() => {
    if (!api?.mobileLogin) return
    let active = true
    void api.mobileLogin().then((value) => { if (active) setLink(value) }, (reason: unknown) => { if (active) setError(cleanIpcError(reason)) })
    return () => { active = false }
  }, [api, attempt])
  const load = () => { setLink(null); setError(''); setAttempt((value) => value + 1) }
  const expired = Boolean(link) && left === 0

  return (
    <Overlay label={uiText('Войти в мобильную версию')} onClose={onClose}>
      <div className="registration-icon"><Smartphone size={28} /></div>
      <div className="eyebrow">{uiText('Мобильная версия')}</div>
      <h2>{uiText('Войти в мобильную версию')}</h2>
      <p className="muted">{uiText('Наведите камеру телефона на QR-код. Откроется приложение Raid OS и само войдёт в этот аккаунт. Если приложения нет, откроется сайт.')}</p>
      {link && <div className={`account-qr-frame${expired ? ' is-expired' : ''}`}><QrCode value={link.url} label={uiText('QR-код для входа в мобильную версию')} /></div>}
      {!link && busy && <div className="account-qr-frame"><LoaderCircle className="spin" size={40} color="#333" /></div>}
      {link && !expired && <div className="account-qr-timer">{uiText('Код действует ещё')} {text} {uiText('и работает один раз')}</div>}
      {expired && <div className="account-qr-timer">{uiText('Код истёк')}</div>}
      {link && !link.reachable && <div className="import-warning"><AlertTriangle size={17} /><span>{uiText('Сервер работает только на этом компьютере (127.0.0.1): телефон до него не достанет. Включите «Открыть сайт друзьям» или укажите постоянный адрес сервера.')}</span></div>}
      {error && <div className="import-warning" role="alert"><AlertTriangle size={17} /><span>{uiText(error)}</span></div>}
      {(expired || error) && <button type="button" className="button primary" disabled={busy} onClick={load}><RefreshCw size={15} className={busy ? 'spin' : ''} />{uiText('Обновить QR-код')}</button>}
      <div className="import-note"><ShieldCheck size={14} />{uiText('В QR-коде нет пароля и постоянного ключа: только одноразовый код на 2 минуты. Не показывайте его другим людям.')}</div>
    </Overlay>
  )
}

/**
 * «Подтвердить вход на сайте»: the website's «Войти по QR-коду» shows a code; typing it here (signed in) signs that
 * browser in. The app first shows which browser asks and when, so a code from somebody else is not approved blindly.
 */
export function ApproveWebLoginDialog({ onClose, initialCode = '' }: { onClose: () => void; initialCode?: string }) {
  const { locale } = useLocale()
  const [code, setCode] = useState(initialCode)
  const [inspected, setInspected] = useState<Inspected | null>(null)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const call = async (step: 'inspect' | 'approve') => {
    const request = serviceClient()
    if (!request) throw new Error('Войдите в аккаунт')
    const answer = await request('POST', `/v1/accounts/me/qr-login/${step}`, { code: code.trim() })
    if (!answer) throw new Error('Войдите в аккаунт')
    return answer
  }
  const run = (step: 'inspect' | 'approve') => {
    setBusy(true)
    setError('')
    void call(step).then((answer) => {
      if (step === 'inspect') setInspected(answer as Inspected)
      else setDone(true)
    }, (reason: unknown) => { setError(cleanIpcError(reason)); if (step === 'approve') setInspected(null) }).finally(() => setBusy(false))
  }
  const submit = (event: FormEvent) => { event.preventDefault(); if (!inspected) run('inspect') }

  return (
    <Overlay label={uiText('Подтвердить вход на сайте')} onClose={onClose}>
      <div className="registration-icon"><Globe size={28} /></div>
      <div className="eyebrow">{uiText('Сайт · вход по QR-коду')}</div>
      <h2>{uiText('Подтвердить вход на сайте')}</h2>
      {!done && <p className="muted">{uiText('На сайте нажмите «Войти по QR-коду» и введите сюда код под QR-кодом. Браузер войдёт в этот аккаунт.')}</p>}
      {!done && !inspected && (
        <form onSubmit={submit}>
          <input className="input account-code-input" value={code} onChange={(event) => { setCode(event.target.value.toUpperCase()); setError('') }} placeholder="XXXX-XXXX" maxLength={9} autoFocus autoComplete="off" spellCheck={false} aria-label={uiText('Код с сайта')} />
          <button type="submit" className="button primary" disabled={busy || code.replace(/[\s-]/g, '').length !== 8}>{busy ? <LoaderCircle className="spin" size={16} /> : <QrIcon size={16} />}{uiText('Продолжить')}</button>
        </form>
      )}
      {!done && inspected && (
        <>
          <div className="account-approve-info">
            <strong>{uiText('Вход запрашивает:')} {uiText(describeAgent(inspected.agent))}</strong>
            <small>{uiText('Откуда:')} {describePlace(inspected, locale) || uiText('неизвестно')}</small>
            <small>{uiText('Код создан в')} {new Date(inspected.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</small>
          </div>
          <div className="import-warning"><AlertTriangle size={17} /><span>{uiText('Разрешайте, только если сайт открыли вы сами. Если код прислал кто-то другой, нажмите «Отмена».')}</span></div>
          <div className="account-approve-actions">
            <button type="button" className="button ghost" onClick={onClose}>{uiText('Отмена')}</button>
            <button type="button" className="button primary" disabled={busy} onClick={() => run('approve')}>{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{uiText('Разрешить вход')}</button>
          </div>
        </>
      )}
      {done && <div className="import-note" role="status"><Check size={14} />{uiText('Готово: браузер вошёл в ваш аккаунт.')}</div>}
      {error && <div className="import-warning" role="alert"><AlertTriangle size={17} /><span>{uiText(error)}</span></div>}
    </Overlay>
  )
}
