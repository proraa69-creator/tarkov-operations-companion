import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw, RotateCcw, ScrollText, X } from 'lucide-react'
import type { WatchdogAlert, WatchdogLamp, WatchdogServiceId, WatchdogSnapshot } from '../electron'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { agoText, watchdogText } from './serverStatusText'
import '../styles/serverStatus.css'

const LABELS: Record<WatchdogServiceId, string> = { api: 'Сервер (API)', site: 'Сайт', public: 'Публичный адрес', database: 'База данных' }
const LAMP_TITLE: Record<WatchdogLamp, string> = { green: 'работает', amber: 'запускается / перезапуск / предупреждение', red: 'ошибка', grey: 'выключено' }
const RESTARTABLE: WatchdogServiceId[] = ['api', 'site', 'public']

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Live watchdog snapshot (status lamps) and alerts from the main process; owner build only. */
export function useServerWatchdog(onAlert?: (alert: WatchdogAlert) => void) {
  const api = window.tarkovDesktop?.account
  const [snapshot, setSnapshot] = useState<WatchdogSnapshot | null>(null)
  useEffect(() => {
    if (!api?.watchdogStatus) return
    let alive = true
    const load = () => void api.watchdogStatus?.().then((next) => { if (alive) setSnapshot(next) }).catch(() => {})
    load()
    const timer = window.setInterval(load, 5000)
    const off = api.onWatchdog?.((next) => { if (alive) setSnapshot(next) }, (alert) => onAlert?.(alert))
    return () => { alive = false; window.clearInterval(timer); off?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onAlert is read through the latest render
  }, [api])
  return { snapshot, setSnapshot, available: Boolean(api?.watchdogStatus) }
}

/**
 * Status block «Сервер (API) / Сайт / Публичный адрес / База данных»: a lamp (green — работает, amber — запускается,
 * перезапуск или предупреждение, red — ошибка, grey — выключено), a short status, the last error, when it was
 * checked, «Перезапустить сейчас» and the journal of the watchdog (electron/serverWatchdog.ts).
 */
export function ServerStatusLamps({ snapshot, onSnapshot, hostname }: { snapshot: WatchdogSnapshot | null; onSnapshot: (next: WatchdogSnapshot) => void; hostname?: string }) {
  const api = window.tarkovDesktop?.account
  const { locale } = useLocale()
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<WatchdogServiceId | 'check' | null>(null)
  const [journal, setJournal] = useState(false)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  if (!snapshot) return null
  const run = (key: WatchdogServiceId | 'check', action: () => Promise<WatchdogSnapshot> | undefined) => {
    setBusy(key)
    void Promise.resolve(action()).then((next) => { if (next) onSnapshot(next) }).catch(() => {}).finally(() => setBusy(null))
  }
  const label = (id: WatchdogServiceId) => (id === 'public' ? `${uiText(LABELS[id])} (${hostname || 'raidos.app'})` : uiText(LABELS[id]))
  return (
    <section className="server-lamps" aria-label={uiText('Состояние сервера')}>
      <div className="server-lamps-head">
        <strong>{uiText('Состояние')}</strong>
        <span className={`server-lamp is-${snapshot.worst}`} aria-hidden="true" />
        <small className="dim">{snapshot.enabled ? agoText(snapshot.checkedAt, now, locale) : uiText('сервер на этом компьютере выключен')}</small>
        {api?.watchdogCheck && snapshot.enabled && (
          <button className="button ghost server-lamps-mini" disabled={busy !== null} onClick={() => run('check', () => api.watchdogCheck?.())} title={uiText('Проверить сейчас')}>
            <RefreshCw size={13} className={busy === 'check' ? 'spin' : ''} />{uiText('Проверить')}
          </button>
        )}
      </div>
      <ul className="server-lamps-list">
        {snapshot.services.map((service) => (
          <li key={service.id} className={`server-lamps-row is-${service.lamp}`}>
            <span className={`server-lamp is-${service.lamp}`} title={uiText(LAMP_TITLE[service.lamp])} role="img" aria-label={uiText(LAMP_TITLE[service.lamp])} />
            <span className="server-lamps-text">
              <span className="server-lamps-title">
                <strong>{label(service.id)}</strong>
                {RESTARTABLE.includes(service.id) && snapshot.enabled && api?.restartService && (
                  <button className="button ghost server-lamps-mini" disabled={busy !== null} onClick={() => run(service.id, () => api.restartService?.(service.id as 'api' | 'site' | 'public'))} title={uiText('Перезапустить сейчас')}>
                    <RotateCcw size={13} className={busy === service.id ? 'spin' : ''} />{uiText('Перезапустить сейчас')}
                  </button>
                )}
              </span>
              <small>{uiText(service.text)}{service.attempts > 0 ? ` · ${uiText('попыток:')} ${service.attempts}` : ''}{service.nextRetryAt && service.nextRetryAt > now ? ` · ${uiText('следующая через')} ${Math.ceil((service.nextRetryAt - now) / 1000)} ${locale === 'en' ? 's' : 'с'}` : ''}</small>
              {service.lastError && <small className="server-lamps-error">{watchdogText(service.lastError, locale)}</small>}
              {snapshot.enabled && <small className="dim">{agoText(service.checkedAt, now, locale)}</small>}
            </span>
          </li>
        ))}
      </ul>
      <button className="server-lamps-journal-toggle" aria-expanded={journal} onClick={() => setJournal(!journal)}>
        <ScrollText size={13} />{uiText('Журнал')} <small className="dim">({snapshot.events.length})</small>
      </button>
      {journal && (
        <ol className="server-lamps-journal">
          {snapshot.events.length === 0 && <li className="dim">{uiText('Событий пока нет')}</li>}
          {snapshot.events.map((event, index) => (
            <li key={`${event.at}-${index}`} className={`is-${event.level}`}>
              <time>{clock(event.at)}</time>
              <span>{watchdogText(event.text, locale)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** In-app toast for watchdog alerts (the same text as the Windows notification). */
export function ServerAlertToast({ alerts, onClose }: { alerts: WatchdogAlert[]; onClose: (alert: WatchdogAlert) => void }) {
  const { locale } = useLocale()
  if (!alerts.length) return null
  // On <body>: the top bar's backdrop-filter would otherwise pin «fixed» toasts inside the bar.
  return createPortal(
    <div className="server-toasts" role="status" aria-live="polite">
      {alerts.map((alert) => (
        <div key={`${alert.at}-${alert.service}-${alert.kind}`} className={`server-toast panel is-${alert.kind}`}>
          <span className={`server-lamp is-${alert.kind === 'repaired' || alert.kind === 'recovered' ? 'green' : 'red'}`} aria-hidden="true" />
          <span className="server-toast-text"><strong>{watchdogText(alert.title, locale)}</strong><small>{watchdogText(alert.body, locale)}</small></span>
          <button className="icon-button" onClick={() => onClose(alert)} aria-label={uiText('Закрыть')}><X size={14} /></button>
        </div>
      ))}
    </div>,
    document.body,
  )
}

/** The status block on its own (Profile → «Аккаунт сервера»): loads the snapshot itself. */
export function ServerStatusBlock() {
  const { snapshot, setSnapshot, available } = useServerWatchdog()
  const [hostname, setHostname] = useState<string | undefined>()
  useEffect(() => { void window.tarkovDesktop?.account?.tunnelStatus?.().then((tunnel) => setHostname(tunnel.hostname)).catch(() => {}) }, [])
  if (!available) return null
  return <ServerStatusLamps snapshot={snapshot} onSnapshot={setSnapshot} hostname={hostname} />
}
