import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowDownCircle, ArrowUpCircle, X } from 'lucide-react'
import { raidRunning, useRaidState } from '../app/useRaidState'
import { useTarkovData } from '../data/DataProvider'
import { useTradingStats } from '../data/tradingApi'
import { useLocale } from '../i18n/LocaleProvider'
import { useAppState } from '../state/AppState'
import { formatPrice } from '../shared/format'
import { boardRows, currentPrice, feeOptionsFor, knownLevel, notifiable, traderOffer, type BoardRow } from './tradingBoard'
import { positionStatus, useAllPositions } from './tradingPositions'
import { setTradingSignalCount, useMinuteClock } from './tradingClock'
import { readNotifiedSignals, readTradingSettings, rememberNotifiedSignals, useTradingSettings } from './tradingSettings'

/** At most this many messages at a time: a market-wide dip must not bury the screen. */
const MAX_AT_ONCE = 3
/** A message stays this long: by then the price has probably moved. */
const TOAST_MS = 5 * 60_000

interface Toast { key: string; itemId: string; kind: 'buy' | 'sell'; title: string; text: string; until: number; bought?: boolean }

function messageOf(entry: BoardRow, locale: 'ru' | 'en'): Pick<Toast, 'title' | 'text'> {
  const signal = entry.signal!
  const name = entry.item.shortName || entry.item.name
  const price = formatPrice(signal.price)
  const profit = formatPrice(signal.profit)
  if (signal.kind === 'sell') {
    return locale === 'en'
      ? { title: 'Price is up: you can sell', text: `${name} ${price}: list it, ~${formatPrice(signal.net!)} left after the fee. An estimate from price history.` }
      : { title: 'Цена выросла: можно продавать', text: `${name} ${price}: выставляйте, после комиссии останется ~${formatPrice(signal.net!)}. Оценка по истории цен.` }
  }
  if (signal.route === 'trader') {
    return locale === 'en'
      ? { title: 'Price fell: you can buy', text: `${name} ${price}, ${entry.traderName} pays ${formatPrice(entry.traderPrice)}: ~+${profit} at once. An estimate from price history.` }
      : { title: 'Цена упала: можно покупать', text: `${name} ${price}, ${entry.traderName} платит ${formatPrice(entry.traderPrice)}: ~+${profit} сразу. Оценка по истории цен.` }
  }
  return locale === 'en'
    ? { title: 'Price fell: you can buy', text: `${name} ${price}, usually ${formatPrice(entry.row.w7.p50)}: ~+${profit} when the price is back. An estimate from price history.` }
    : { title: 'Цена упала: можно покупать', text: `${name} ${price}, обычно ${formatPrice(entry.row.w7.p50)}: ~+${profit}, когда цена вернётся. Оценка по истории цен.` }
}

/**
 * The messages of «Торговля» (owner, 05.11.2026: «должны быть уведомления»). No polling of its own: the catalog's regular
 * update brings the prices (every 10 minutes while the window is in use), the statistics come every 3 hours. Nothing
 * during a raid, nothing while the character's level is unknown, nothing the market has not opened at that level, once per
 * dip.
 */
export function TradingNotifier() {
  const state = useAppState()
  const mode = state.raidMode
  const { data, source } = useTarkovData()
  const { locale } = useLocale()
  const settings = useTradingSettings()
  const raid = useRaidState()
  const navigate = useNavigate()
  // The page itself shows every signal: no messages over it.
  const onPage = useLocation().pathname === '/economy/trading'
  const { data: snapshot } = useTradingStats(mode, settings.enabled)
  const allPositions = useAllPositions()
  const [toasts, setToasts] = useState<Toast[]>([])
  const seen = useRef<Record<string, number> | null>(null)
  const progress = state.activeProfile.modes[mode]
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const clock = useMinuteClock()
  const inRaid = raidRunning(raid, clock)
  const level = knownLevel(progress)

  useEffect(() => {
    if (inRaid || source === 'demo' || data.metadata?.mode !== mode) { setTradingSignalCount(0); return }
    const now = Date.now()
    const flea = data.metadata?.fleaMarket
    const fee = feeOptionsFor(snapshot ?? { fee: { offerFeeRate: flea?.offerFeeRate ?? 0.05, requirementFeeRate: flea?.requirementFeeRate ?? 0.05 } }, data.hideout, progress.hideoutLevels)
    // What the player bought comes first: they asked for this message themselves, whatever the threshold of the signals.
    const purchases = allPositions.filter((position) => position.mode === mode && position.notify).flatMap((position) => {
      const item = items.get(position.itemId)
      if (!item) return []
      const offer = traderOffer(item, mode)
      const status = positionStatus(position, currentPrice(item, mode), offer?.price ?? 0, fee)
      if (!status.ready) return []
      const name = item.shortName || item.name
      const earned = formatPrice(status.earned ?? 0)
      const text = status.route === 'trader'
        ? locale === 'en' ? `${name}: ${offer?.source} pays ${formatPrice(offer?.price ?? 0)}, +${earned}. An estimate.` : `${name}: ${offer?.source} платит ${formatPrice(offer?.price ?? 0)}, +${earned}. Оценка.`
        : locale === 'en' ? `${name}: list from ${formatPrice(status.ask!)}, now +${earned} after the fee. An estimate.` : `${name}: выставляйте от ${formatPrice(status.ask!)}, сейчас +${earned} после комиссии. Оценка.`
      return [{ key: `${mode}:${position.itemId}:bought:${position.paid}:${position.plus}`, itemId: position.itemId, kind: 'sell' as const, until: now + TOAST_MS, bought: true, title: locale === 'en' ? 'You can sell what you bought' : 'Можно продавать купленное', text }]
    })
    const signals = settings.enabled && snapshot && level !== undefined
      ? notifiable(boardRows({ snapshot, items, mode, period: 7, fee, playerLevel: level, now }), settings.minProfit).map((entry): Toast => ({ key: `${mode}:${entry.row.id}:${entry.signal!.kind}`, itemId: entry.row.id, kind: entry.signal!.kind, until: now + TOAST_MS, ...messageOf(entry, locale) }))
      : []
    setTradingSignalCount(signals.length + purchases.length)
    seen.current ??= readNotifiedSignals(now)
    const known = seen.current
    const fresh = [...purchases, ...(readTradingSettings().enabled ? signals : [])].filter((toast) => !known[toast.key])
    if (!fresh.length) return
    // Every new signal counts as told, not only the biggest shown: the rest must not trickle out at each catalog update.
    for (const toast of fresh) known[toast.key] = now
    const next: Toast[] = fresh.slice(0, MAX_AT_ONCE)
    rememberNotifiedSignals(known)
    for (const toast of next) void window.tarkovDesktop?.notify?.(toast.title, toast.text).catch(() => false)
    setToasts((current) => [...current.filter((toast) => toast.until > now), ...next].slice(-MAX_AT_ONCE))
  }, [allPositions, data.hideout, data.metadata?.fleaMarket, data.metadata?.mode, inRaid, items, level, locale, mode, progress.hideoutLevels, settings.enabled, source, settings.minProfit, snapshot])

  useEffect(() => {
    if (!toasts.length) return
    const timer = window.setTimeout(() => {
      const now = Date.now()
      setToasts((current) => current.filter((toast) => toast.until > now))
    }, Math.max(1000, Math.min(...toasts.map((toast) => toast.until)) - Date.now()))
    return () => window.clearTimeout(timer)
  }, [toasts])

  const visible = toasts.filter((toast) => toast.bought || settings.enabled)
  if (inRaid || onPage || !visible.length) return null
  return (
    <div className="restock-toasts trading-toasts" role="status" aria-live="polite">
      {visible.map((toast) => (
        <div key={toast.key} className={`restock-toast trading-toast ${toast.kind}`}>
          {toast.kind === 'buy' ? <ArrowDownCircle size={16} /> : <ArrowUpCircle size={16} />}
          <button type="button" className="trading-toast-body" onClick={() => {
            setToasts((current) => current.filter((entry) => entry.key !== toast.key))
            navigate(`/economy/trading?item=${toast.itemId}`)
          }}><strong>{toast.title}</strong><span>{toast.text}</span></button>
          <button type="button" className="icon-button" aria-label={locale === 'en' ? 'Close' : 'Закрыть'} onClick={() => setToasts((current) => current.filter((entry) => entry.key !== toast.key))}><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}
