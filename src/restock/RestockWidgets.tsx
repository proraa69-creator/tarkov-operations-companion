import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, Timer, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useAppState } from '../state/AppState'
import type { Trader } from '../domain/types'
import { dueNotifications, findReset, formatCountdown, LEAD_MINUTE_CHOICES, msUntilRestock, nextNotificationDelay, nextRestock, type DueNotification } from './restock'
import { useTraderResets } from './restockSource'
import { readNotified, rememberNotified, useRestockSettings, writeRestockSettings } from './restockSettings'
import '../arsenal/arsenal.css'

const SOON_MS = 10 * 60_000

/** Re-renders every `interval` ms (countdowns). */
function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), interval)
    return () => window.clearInterval(timer)
  }, [interval])
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

interface Toast { key: string; text: string }

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
  const [tick, setTick] = useState(0)
  const notified = useRef<Set<string>>(readNotified())
  const resets = useMemo(() => data ?? [], [data])

  useEffect(() => {
    const now = Date.now()
    const due: DueNotification[] = dueNotifications(resets, settings, now, notified.current)
    if (due.length) {
      for (const entry of due) {
        notified.current.add(entry.key)
        const title = locale === 'en' ? 'Trader restock soon' : 'Скоро ресток'
        const body = locale === 'en'
          ? `${entry.trader.name} restocks in ${entry.minutesLeft} min`
          : `${entry.trader.name}: ресток через ${entry.minutesLeft} мин`
        void window.tarkovDesktop?.notify?.(title, body).catch(() => false)
        setToasts((current) => [...current.filter((toast) => toast.key !== entry.key), { key: entry.key, text: body }].slice(-3))
      }
      rememberNotified(notified.current, now)
    }
    // Wake up when the next window opens (capped, so a sleeping laptop or a changed clock is caught within a minute).
    const delay = nextNotificationDelay(resets, settings, now, notified.current)
    if (delay === undefined) return
    const timer = window.setTimeout(() => setTick((value) => value + 1), Math.min(Math.max(delay, 1000), 60_000))
    return () => window.clearTimeout(timer)
  }, [resets, settings, locale, tick])

  if (!toasts.length) return null
  return (
    <div className="restock-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.key} className="restock-toast">
          <BellRing size={16} />
          <span><strong>{uiText('Скоро ресток')}</strong><br />{toast.text}</span>
          <button type="button" className="icon-button" aria-label={uiText('Понятно')} onClick={() => setToasts((current) => current.filter((entry) => entry.key !== toast.key))}><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}
