import { useEffect, useMemo, useRef, useState } from 'react'
import { startActivePolling } from '../app/activePolling'
import { useNavigate } from 'react-router-dom'
import { BellRing, Timer, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useAppState } from '../state/AppState'
import type { Trader } from '../domain/types'
import { dueNotifications, findReset, formatCountdown, LEAD_MINUTE_CHOICES, msUntilRestock, nextNotificationDelay, nextRestock, type DueNotification } from './restock'
import { useTraderResets } from './restockSource'
import { readNotified, readRestockSettings, rememberNotified, useRestockSettings, writeRestockSettings } from './restockSettings'
import '../arsenal/arsenal.css'

const SOON_MS = 10 * 60_000

/**
 * Re-renders every `interval` ms (countdowns). In the desktop app only while the window is in use: the top-bar countdown
 * re-rendered every second behind the game, where nobody sees it; it shows the right time again the moment the window
 * is used (src/app/activePolling.ts). The restock notifications have their own timer (RestockNotifier).
 */
function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => startActivePolling(() => setNow(Date.now()), { activeEveryMs: interval, followFocus: Boolean(window.tarkovDesktop) }), [interval])
  return now
}

function useModeResets() {
  const { raidMode } = useAppState()
  const { locale } = useLocale()
  return useTraderResets(raidMode, locale)
}

/** Top bar: the next trader restock with a live countdown; opens «Торговцы». */
export function TopbarRestock() {
  const { data } = useModeResets()
  const now = useNow()
  const navigate = useNavigate()
  const next = data ? nextRestock(data, now) : undefined
  if (!next) return null
  const left = next.at - now
  return (
    <button
      type="button"
      className={`restock-pill${left < SOON_MS ? ' soon' : ''}`}
      onClick={() => navigate('/traders')}
      title={uiText('Ближайший ресток')}
      aria-label={`${uiText('Ближайший ресток')}: ${next.trader.name} ${formatCountdown(left)}`}
    >
      <Timer size={14} />
      <span>{next.trader.name}</span>
      <strong>{formatCountdown(left)}</strong>
    </button>
  )
}

/** Countdown under a trader card on «Торговцы». */
export function TraderRestockTimer({ trader }: { trader: Pick<Trader, 'id' | 'name'> }) {
  const { data, isLoading } = useModeResets()
  const now = useNow()
  if (isLoading) return null
  const reset = findReset(data, trader)
  const left = reset ? msUntilRestock(reset, now) : undefined
  if (left === undefined) return <small className="restock-timer">{uiText('нет данных о рестоке')}</small>
  if (left <= 0) return <small className="restock-timer soon">{uiText('обновляется…')}</small>
  return (
    <small className={`restock-timer${left < SOON_MS ? ' soon' : ''}`}>
      {uiText('ресток через')} {formatCountdown(left)}
    </small>
  )
}

/** Settings → «Уведомления о рестоке»: on/off, lead time and traders. */
export function RestockSettingsPanel() {
  const settings = useRestockSettings()
  const { data } = useModeResets()
  const traders = (data ?? []).filter((trader) => trader.resetTime)
  const toggleTrader = (id: string) => writeRestockSettings({
    traderIds: settings.traderIds.includes(id) ? settings.traderIds.filter((entry) => entry !== id) : [...settings.traderIds, id],
  })
  return (
    <div className="restock-settings">
      <div className="setting-row">
        <span>
          <strong>{uiText('Уведомления о рестоке')}</strong>
          <small>{uiText('Напоминание за несколько минут до рестока выбранных торговцев')}</small>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          aria-label={uiText('Уведомления о рестоке')}
          className={`toggle ${settings.enabled ? 'on' : ''}`}
          onClick={() => writeRestockSettings({ enabled: !settings.enabled })}
        >
          <span />
        </button>
      </div>
      <div className="setting-row">
        <span><strong>{uiText('За сколько минут')}</strong></span>
        <select
          className="select"
          aria-label={uiText('За сколько минут')}
          value={settings.leadMinutes}
          onChange={(event) => writeRestockSettings({ leadMinutes: Number(event.target.value) })}
        >
          {LEAD_MINUTE_CHOICES.map((minutes) => <option key={minutes} value={minutes}>{minutes}</option>)}
        </select>
      </div>
      <div className="stat-label" style={{ marginTop: 10 }}>{uiText('Торговцы для уведомлений')}</div>
      <div className="trader-checks">
        {traders.map((trader) => {
          const on = settings.traderIds.includes(trader.id)
          return (
            <label key={trader.id} className={`trader-check${on ? ' on' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => toggleTrader(trader.id)} />
              {trader.name}
            </label>
          )
        })}
        {!traders.length && <small className="dim">{uiText('нет данных о рестоке')}</small>}
      </div>
      <small className="dim">{uiText('На компьютере — системное уведомление Windows, в приложении для телефона — сообщение внутри приложения, пока оно открыто.')}</small>
    </div>
  )
}

interface Toast { key: string; traderId: string; at: number; text: string }

/**
 * Watches the selected mode's restock times and notifies `leadMinutes` before each chosen trader restocks:
 * a system notification in the desktop app (Electron), and an in-app message everywhere (the phone app has no
 * local-notification plugin, so it only notifies while open).
 */
export function RestockNotifier() {
  const { data } = useModeResets()
  const settings = useRestockSettings()
  const { locale } = useLocale()
  const [toasts, setToasts] = useState<Toast[]>([])
  // The time of the last wake-up: a new restock window opens, or a message outlives its restock.
  const [clock, setClock] = useState(() => Date.now())
  const notified = useRef<Set<string>>(readNotified())
  const resets = useMemo(() => data ?? [], [data])

  useEffect(() => {
    const now = Date.now()
    // The stored switch, read again right before notifying: a change made a moment ago always wins.
    const due: DueNotification[] = readRestockSettings().enabled ? dueNotifications(resets, settings, now, notified.current) : []
    if (due.length) {
      for (const entry of due) {
        notified.current.add(entry.key)
        const title = locale === 'en' ? 'Trader restock soon' : 'Скоро ресток'
        const body = locale === 'en'
          ? `${entry.trader.name} restocks in ${entry.minutesLeft} min`
          : `${entry.trader.name}: ресток через ${entry.minutesLeft} мин`
        void window.tarkovDesktop?.notify?.(title, body).catch(() => false)
        setToasts((current) => [...current.filter((toast) => toast.key !== entry.key), { key: entry.key, traderId: entry.trader.id, at: entry.at, text: body }].slice(-3))
      }
      rememberNotified(notified.current, now)
    }
    // Wake up when the next window opens (capped, so a sleeping laptop or a changed clock is caught within a minute).
    // Also wake up when a message on screen outlives its restock, so it goes away by itself.
    const nextDue = nextNotificationDelay(resets, settings, now, notified.current)
    const live = toasts.filter((toast) => toast.at > now)
    const firstExpiry = live.length ? Math.min(...live.map((toast) => toast.at)) - now : undefined
    // A message whose restock passed while nothing ran (a sleeping laptop) is cleared on the next wake-up, a second later.
    const delay = toasts.length > live.length ? 0
      : nextDue === undefined ? firstExpiry : firstExpiry === undefined ? nextDue : Math.min(nextDue, firstExpiry)
    if (delay === undefined) return
    const timer = window.setTimeout(() => {
      const at = Date.now()
      setClock(at)
      setToasts((current) => current.some((toast) => toast.at <= at) ? current.filter((toast) => toast.at > at) : current)
    }, Math.min(Math.max(delay, 1000), 60_000))
    return () => window.clearTimeout(timer)
  }, [resets, settings, locale, clock, toasts])

  // Turned off (owner, 15.10.2026: «даже если выключено, то все равно уведомления появляются»): nothing is shown, and a
  // message already on screen goes at once, as does one for a trader taken off the list or a restock that has passed.
  const visible = settings.enabled ? toasts.filter((toast) => toast.at > clock && settings.traderIds.includes(toast.traderId)) : []
  if (!visible.length) return null
  return (
    <div className="restock-toasts" role="status" aria-live="polite">
      {visible.map((toast) => (
        <div key={toast.key} className="restock-toast">
          <BellRing size={16} />
          <span><strong>{uiText('Скоро ресток')}</strong><br />{toast.text}</span>
          <button type="button" className="icon-button" aria-label={uiText('Понятно')} onClick={() => setToasts((current) => current.filter((entry) => entry.key !== toast.key))}><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}
