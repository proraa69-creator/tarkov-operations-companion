import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { raidRunning, useRaidState } from '../app/useRaidState'
import { useTarkovData } from '../data/DataProvider'
import { useTradingStats } from '../data/tradingApi'
import { useLocale } from '../i18n/LocaleProvider'
import { useAppState } from '../state/AppState'
import { formatPrice } from '../shared/format'
import { boardRows, currentPrice, feeOptionsFor, knownLevel, notifiable, traderOffer, type BoardRow } from './tradingBoard'
import { setTradingSignalCount, useMinuteClock } from './tradingClock'
import { positionStatus, useAllPositions } from './tradingPositions'
import { readNotifiedSignals, readTradingSettings, rememberNotifiedSignals, useTradingSettings } from './tradingSettings'

/** At most this many messages at a time: a market-wide dip must not bury the screen. */
const MAX_AT_ONCE = 3
/** A message stays this long: by then the price has probably moved. */
const TOAST_MS = 5 * 60_000

interface Toast { key: string; itemId: string; icon?: string; kind: 'buy' | 'sell'; title: string; text: string; until: number; bought?: boolean }

/** Short on purpose (owner: «в окне более-менее короткую информацию… а вот уже в самом блоке нужно подробно»). */
function messageOf(entry: BoardRow, locale: 'ru' | 'en'): Pick<Toast, 'title' | 'text'> {
  const signal = entry.signal!
  const name = entry.item.shortName || entry.item.name
  const price = formatPrice(signal.price)
  const profit = formatPrice(signal.profit)
  if (signal.kind === 'sell') {
    return locale === 'en'
      ? { title: `${name}: price is up`, text: `${price}: ~${formatPrice(signal.net!)} after the fee. An estimate.` }
      : { title: `${name}: цена выросла`, text: `${price}: ~${formatPrice(signal.net!)} после комиссии. Оценка.` }
  }
  if (signal.route === 'trader') {
    return locale === 'en'
      ? { title: `${name}: price fell`, text: `${price}, ${entry.traderName} pays ${formatPrice(entry.traderPrice)}: ~+${profit}. An estimate.` }
      : { title: `${name}: цена упала`, text: `${price}, ${entry.traderName} платит ${formatPrice(entry.traderPrice)}: ~+${profit}. Оценка.` }
  }
  return locale === 'en'
    ? { title: `${name}: price fell`, text: `${price}, usually ${formatPrice(entry.row.w7.p50)}: ~+${profit}. An estimate.` }
    : { title: `${name}: цена упала`, text: `${price}, обычно ${formatPrice(entry.row.w7.p50)}: ~+${profit}. Оценка.` }
}

/** The item's picture as a small PNG for the system's notification; none is no loss: the message goes without it. */
async function pictureOf(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined
  try {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob())
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const scale = Math.min(64 / bitmap.width, 64 / bitmap.height)
    canvas.getContext('2d')?.drawImage(bitmap, (64 - bitmap.width * scale) / 2, (64 - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale)
    return canvas.toDataURL('image/png')
  } catch { return undefined }
}

/**
 * The messages of «Торговля» (owner, 05.11.2026: «Уведомление приходит с картинкой предмета, с надписью предмета, можно
 * сокращенно. И насколько в плюс уйдет»). No polling of its own: the catalog's regular update brings the prices (every 10
 * minutes while the window is in use), the statistics come every 3 hours. Nothing during a raid. Signals: nothing while the
 * character's level is unknown, nothing the market has not opened at that level, once per dip. What the player bought:
 * when the chosen plus is there, and when the lowest price reaches their own threshold, whatever the signals' settings.
 */
export function TradingNotifier() {
  const state = useAppState()
  const mode = state.raidMode
  const { data, source } = useTarkovData()
  const { locale } = useLocale()
  const settings = useTradingSettings()
  const raid = useRaidState()
  const navigate = useNavigate()
  // The page itself shows every signal: no messages about them over it. What the player bought still comes.
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
    const purchases = allPositions.filter((position) => position.mode === mode && position.notify).flatMap((position): Toast[] => {
      const item = items.get(position.itemId)
      if (!item) return []
      const offer = traderOffer(item, mode)
      const current = currentPrice(item, mode)
      const status = positionStatus(position, current, offer?.price ?? 0, fee)
      const name = item.shortName || item.name
      const icon = item.iconUrl ? { icon: item.iconUrl } : {}
      const messages: Toast[] = []
      if (status.ready) {
        const earned = formatPrice(status.earned ?? 0)
        const text = status.route === 'trader'
          ? locale === 'en' ? `+${earned}: ${offer?.source} pays ${formatPrice(offer?.price ?? 0)}. An estimate.` : `+${earned}: ${offer?.source} платит ${formatPrice(offer?.price ?? 0)}. Оценка.`
          : locale === 'en' ? `+${earned}: list from ${formatPrice(status.ask!)}. An estimate.` : `+${earned}: выставляйте от ${formatPrice(status.ask!)}. Оценка.`
        messages.push({ key: `${mode}:${position.itemId}:bought:${position.paid}:${position.plus}`, itemId: position.itemId, ...icon, kind: 'sell', until: now + TOAST_MS, bought: true, title: locale === 'en' ? `${name}: you can sell` : `${name}: можно продавать`, text })
      }
      if (status.priceReached && position.alertPrice) {
        const plus = status.nowPlus ?? 0
        const earned = `${plus >= 0 ? '+' : '−'}${formatPrice(Math.abs(plus))}`
        messages.push({ key: `${mode}:${position.itemId}:price:${position.paid}:${position.alertPrice}`, itemId: position.itemId, ...icon, kind: 'sell', until: now + TOAST_MS, bought: true, title: locale === 'en' ? `${name}: ${formatPrice(position.alertPrice)} reached` : `${name}: цена дошла до ${formatPrice(position.alertPrice)}`, text: locale === 'en' ? `Now ${formatPrice(current ?? 0)}, if sold ${earned}. An estimate.` : `Сейчас ${formatPrice(current ?? 0)}, если продать ${earned}. Оценка.` })
      }
      return messages
    })
    const signals = settings.enabled && snapshot && level !== undefined
      ? notifiable(boardRows({ snapshot, items, mode, period: 7, fee, playerLevel: level, now }), settings.minProfit).map((entry): Toast => ({ key: `${mode}:${entry.row.id}:${entry.signal!.kind}`, itemId: entry.row.id, ...(entry.item.iconUrl ? { icon: entry.item.iconUrl } : {}), kind: entry.signal!.kind, until: now + TOAST_MS, ...messageOf(entry, locale) }))
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
    for (const toast of next) {
      void pictureOf(toast.icon).then((picture) => window.tarkovDesktop?.notify?.(toast.title, toast.text, picture)).catch(() => false)
    }
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

  const visible = toasts.filter((toast) => toast.bought || (settings.enabled && !onPage))
  if (inRaid || !visible.length) return null
  return (
    <div className="restock-toasts trading-toasts" role="status" aria-live="polite">
      {visible.map((toast) => (
        <div key={toast.key} className={`restock-toast trading-toast ${toast.kind}`}>
          {toast.icon && <img src={toast.icon} alt="" className="trading-toast-picture" />}
          <button type="button" className="trading-toast-body" onClick={() => {
            setToasts((current) => current.filter((entry) => entry.key !== toast.key))
            navigate(toast.bought ? `/economy/trading?view=bought&item=${toast.itemId}` : `/economy/trading?item=${toast.itemId}`)
          }}><strong>{toast.title}</strong><span>{toast.text}</span></button>
          <button type="button" className="icon-button" aria-label={locale === 'en' ? 'Close' : 'Закрыть'} onClick={() => setToasts((current) => current.filter((entry) => entry.key !== toast.key))}><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}
