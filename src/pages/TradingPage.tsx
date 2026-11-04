import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, Bell, BellOff, BellRing, Check, ChevronDown, ChevronUp, Info, Search, TrendingDown, TrendingUp } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useLivePrices, withLivePrice } from '../data/livePrices'
import { useTradingStats } from '../data/tradingApi'
import { fleaMarketFee, type FleaFeeOptions } from '../domain/fleaFee'
import { askForNet, floorForAsk, MARKET_LEVEL, reliabilityTier, rowScans, sellForecast, tradingStale, type TradingKind, type TradingRow } from '../domain/trading'
import type { Item, RaidMode } from '../domain/types'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { formatPrice } from '../shared/format'
import { useAppState } from '../state/AppState'
import { TradingChart } from '../trading/TradingChart'
import { boardRows, currentPrice, feeOptionsFor, knownLevel, traderOffer, type BoardRow, type TradingPeriod } from '../trading/tradingBoard'
import { useMinuteClock } from '../trading/tradingClock'
import { PLUS_STEPS, positionStatus, removePosition, savePosition, useAllPositions, type TradingPosition } from '../trading/tradingPositions'
import { TRADING_PROFIT_STEPS, useTradingSettings, writeTradingSettings } from '../trading/tradingSettings'
import '../styles/economy.css'
import '../styles/trading.css'

type Fee = Omit<FleaFeeOptions, 'count'>
type SortKey = 'swing' | 'profit' | 'reliability'
const SIGNALS_SHOWN = 6
/** The top of the window: the signals stay in sight under it. */
const ROWS_SHOWN = 15
const MORE = 'more'

const KINDS: Array<{ key: 'all' | TradingKind; ru: string; en: string }> = [
  { key: 'all', ru: 'Всё', en: 'All' },
  { key: 'barter', ru: 'Бартер', en: 'Barter' },
  { key: 'gear', ru: 'Снаряжение', en: 'Gear' },
  { key: 'other', ru: 'Прочее', en: 'Other' },
]
const SORTS: Array<{ key: SortKey; ru: string; en: string }> = [
  { key: 'swing', ru: 'Сильнее скачет', en: 'Biggest swing' },
  { key: 'profit', ru: 'Больше выгода', en: 'Biggest profit' },
  { key: 'reliability', ru: 'Больше успешных продаж', en: 'Most successful sales' },
]
const sorters: Record<SortKey, (row: BoardRow) => number> = {
  swing: (row) => row.swing,
  profit: (row) => row.estimate.profit,
  reliability: (row) => row.reliability * 1000 + row.row.backtest.signals,
}

const percent = (value: number, digits = 0) => `${value > 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`
const money = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatPrice(Math.abs(Math.round(value)))}`
const digits = (text: string) => Number(text.replace(/\D/g, '')) || 0

/** Successful sales, as the owner asked: of the past month's dips, how many ended in profit. */
function SalesChip({ entry, locale }: { entry: BoardRow; locale: 'ru' | 'en' }) {
  const { wins, signals } = entry.row.backtest
  return <span className={`trading-chip ${reliabilityTier(entry.row.backtest)}`} title={locale === 'en'
    ? `In the past month's price history ${wins} of ${signals} buys on a dip ended in profit. An estimate, not actual deals.`
    : `По истории цен за месяц ${wins} из ${signals} покупок на падении закончились в плюс. Оценка, а не реальные сделки.`}>{wins}/{signals}</span>
}

function SignalCard({ entry, onOpen, locale }: { entry: BoardRow; onOpen: () => void; locale: 'ru' | 'en' }) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const signal = entry.signal!
  return <button type="button" className={`trading-signal ${signal.kind}`} onClick={onOpen}>
    <img src={entry.item.iconUrl} alt="" loading="lazy" className="economy-thumb" />
    <span className="trading-signal-main">
      <strong>{uiText(entry.item.name)}</strong>
      <small className="dim">{formatPrice(signal.price)} · {t('обычно', 'usually')} {formatPrice(entry.row.w7.p50)} ({percent(entry.move ?? 0)})</small>
      <small>{signal.kind === 'sell'
        ? t(`Выставить за ${formatPrice(signal.sellAt!)}, комиссия ${formatPrice(signal.fee!)}`, `List at ${formatPrice(signal.sellAt!)}, fee ${formatPrice(signal.fee!)}`)
        : signal.route === 'trader'
          ? t(`Сразу торговцу: ${uiText(entry.traderName ?? '')} платит ${formatPrice(entry.traderPrice)}`, `To a trader at once: ${uiText(entry.traderName ?? '')} pays ${formatPrice(entry.traderPrice)}`)
          : t(`Продать за ${formatPrice(signal.sellAt!)}, комиссия ${formatPrice(signal.fee!)}`, `Sell at ${formatPrice(signal.sellAt!)}, fee ${formatPrice(signal.fee!)}`)}</small>
    </span>
    <span className="trading-signal-side">
      <strong className="price-up mono">~{money(signal.profit)}</strong>
      {signal.route === 'flea' ? <SalesChip entry={entry} locale={locale} /> : <span className="trading-chip high">{t('сразу', 'at once')}</span>}
    </span>
  </button>
}

/** The player's sum, the fee it costs and the listing that earns it; «Купил» and the message about the start of selling. */
function SaleCalculator({ entry, position, fee, mode, target, setTarget, locale }: {
  entry: BoardRow
  position?: TradingPosition
  fee: Fee
  mode: RaidMode
  target?: number
  setTarget: (price: number | undefined) => void
  locale: 'ru' | 'en'
}) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const { row, traderName, traderPrice, current } = entry
  const [paidText, setPaidText] = useState(position ? String(position.paid) : '')
  const [choice, setChoice] = useState<number | typeof MORE>(position ? (PLUS_STEPS.includes(position.plus as typeof PLUS_STEPS[number]) ? position.plus : MORE) : 0)
  const [moreText, setMoreText] = useState(position && !PLUS_STEPS.includes(position.plus as typeof PLUS_STEPS[number]) ? String(position.plus) : '150000')
  const [notify, setNotify] = useState(position?.notify ?? true)
  const paid = digits(paidText) || current || row.buyBelow
  const plus = choice === MORE ? Math.max(PLUS_STEPS[PLUS_STEPS.length - 1]! + 1, digits(moreText)) : choice
  const breakEven = askForNet(row.base, paid, fee)
  const ask = askForNet(row.base, paid + plus, fee)
  const needed = ask === null ? undefined : floorForAsk(ask)
  useEffect(() => { if (needed !== target) setTarget(needed) }, [needed, setTarget, target])
  const askFee = ask === null ? 0 : fleaMarketFee(row.base, ask, fee)
  const changed = position && (position.paid !== paid || position.plus !== plus || position.notify !== notify)
  const save = () => savePosition({ mode, itemId: row.id, paid, plus, notify, base: row.base, boughtAt: position?.boughtAt ?? Date.now() })
  return <section className="trading-calc">
    <label className="trading-field">
      <span>{t('За сколько купили', 'What you paid')}</span>
      <input className="input mono" inputMode="numeric" value={paidText} placeholder={formatPrice(paid)} aria-label={t('За сколько купили', 'What you paid')} onChange={(event) => setPaidText(event.target.value.replace(/[^\d\s]/g, ''))} />
    </label>
    <dl>
      <div><dt>{t('Минимальная цена продажи, чтобы выйти в плюс', 'Lowest selling price to come out ahead')}</dt><dd className="mono">{breakEven === null ? t('нет такой', 'none') : formatPrice(breakEven)}</dd></div>
      <div><dt>{t('Комиссия при этой цене', 'Fee at that price')}{fee.intelCenterLevel && fee.intelCenterLevel >= 3 ? t(' (Разведцентр 3 ур.: −30%)', ' (Intelligence Center 3: −30%)') : ''}</dt><dd className="mono price-down">{breakEven === null ? '—' : `−${formatPrice(fleaMarketFee(row.base, breakEven, fee))}`}</dd></div>
    </dl>
    <div className="trading-plus" role="group" aria-label={t('Сколько хотите заработать', 'How much you want to earn')}>
      <span>{t('Сколько хотите заработать', 'How much you want to earn')}</span>
      <div className="mode-switch">
        {PLUS_STEPS.map((step) => <button key={step} type="button" className={choice === step ? 'active' : ''} onClick={() => setChoice(step)}>{new Intl.NumberFormat('ru-RU').format(step)}</button>)}
        <button type="button" className={choice === MORE ? 'active' : ''} onClick={() => setChoice(MORE)}>&gt; {new Intl.NumberFormat('ru-RU').format(PLUS_STEPS[PLUS_STEPS.length - 1]!)}</button>
      </div>
      {choice === MORE && <input className="input mono trading-more-sum" inputMode="numeric" value={moreText} aria-label={t('Своя сумма', 'Your own sum')} onChange={(event) => setMoreText(event.target.value.replace(/[^\d\s]/g, ''))} />}
    </div>
    {ask === null
      ? <p className="trading-result none">{t(`Комиссия не даст заработать ${formatPrice(plus)} при покупке за ${formatPrice(paid)}: чем выше цена, тем больше она съедает. Выберите сумму меньше.`, `The fee will not let you earn ${formatPrice(plus)} on ${formatPrice(paid)}: the higher the price, the more it takes. Choose a smaller sum.`)}</p>
      : <div className="trading-result">
          <span>{t('Нужно продать за', 'Sell at')}</span>
          <strong className="mono">{formatPrice(ask)}</strong>
          <small>{t(`Комиссия ${formatPrice(askFee)}, останется ${formatPrice(ask - askFee)}, плюс ${formatPrice(ask - askFee - paid)}. Это когда самая низкая цена на рынке от ${formatPrice(needed!)}.`, `Fee ${formatPrice(askFee)}, ${formatPrice(ask - askFee)} left, ${formatPrice(ask - askFee - paid)} earned. That is when the lowest price on the market is ${formatPrice(needed!)} or more.`)}</small>
        </div>}
    {traderPrice > paid && <p className="trading-note">{t(`Или сразу торговцу: ${uiText(traderName ?? '')} платит ${formatPrice(traderPrice)}, это ${money(traderPrice - paid)}.`, `Or to a trader at once: ${uiText(traderName ?? '')} pays ${formatPrice(traderPrice)}, that is ${money(traderPrice - paid)}.`)}</p>}
    <div className="trading-buy">
      <button type="button" className={`button ${position && !changed ? '' : 'primary'}`} disabled={Boolean(position && !changed)} onClick={save}>
        <Check size={14} /> {position ? (changed ? t('Сохранить', 'Save') : t('Куплено', 'Bought')) : t('Купил', 'Bought it')}
      </button>
      <label className="economy-check"><input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} /> {t('Отправить уведомление о старте продажи', 'Notify me when selling can start')}</label>
      {position && <button type="button" className="button ghost" onClick={() => removePosition(mode, row.id)}>{t('Продал', 'Sold it')}</button>}
    </div>
  </section>
}

/** The width of what can be seen of the table: inside a table cell the chart would otherwise set the width itself. */
function useVisibleWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  useEffect(() => {
    const host = ref.current?.closest('.economy-table-wrap')
    if (!host || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { if (host.clientWidth > 0) setWidth(host.clientWidth) })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

/** A click on an item: the chart with its forecast, the sums under it. */
function ItemDetail({ entry, period, position, fee, mode, now, locale }: { entry: BoardRow; period: TradingPeriod; position?: TradingPosition; fee: Fee; mode: RaidMode; now: number; locale: 'ru' | 'en' }) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const { ref, width } = useVisibleWidth()
  const { row, current, traderPrice, traderName } = entry
  const [target, setTarget] = useState<number | undefined>(undefined)
  const shown = target ?? row.sellAbove
  const forecast = useMemo(() => sellForecast(rowScans(row), shown, current, now), [current, now, row, shown])
  const stampFormat = useMemo(() => new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), [locale])
  const hourFormat = useMemo(() => new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', { hour: '2-digit', minute: '2-digit' }), [locale])
  const clock = (utcHour: number) => {
    const at = new Date(now)
    at.setUTCHours(utcHour, 0, 0, 0)
    return `${hourFormat.format(at)}–${hourFormat.format(at.getTime() + 2 * 3_600_000)}`
  }
  const past = row.backtest
  return <div className="trading-detail" ref={ref} style={{ width }}>
    <TradingChart row={row} period={period} current={current} target={target} trader={traderPrice} now={now} width={width - 28} locale={locale} />
    <div className="trading-detail-grid">
      <SaleCalculator entry={entry} position={position} fee={fee} mode={mode} target={target} setTarget={setTarget} locale={locale} />
      <section className="trading-forecast">
        <h4>{t('Прогноз, когда можно будет продавать', 'Forecast: when you can sell')}</h4>
        <p className="trading-forecast-text">
          {forecast.state === 'now' && t(`Можно продавать сейчас: самая низкая цена уже от ${formatPrice(shown)}.`, `You can sell now: the lowest price is already ${formatPrice(shown)} or more.`)}
          {forecast.state === 'window' && t(`${forecast.chance! < 0.5 ? 'Если дойдёт, то примерно' : 'Примерно'} ${stampFormat.format(forecast.from!)} – ${stampFormat.format(forecast.to!)}. За прошлую неделю цена доходила до ${formatPrice(shown)} в течение двух суток в ${Math.round(forecast.chance! * 100)}% случаев, обычно за ${forecast.hours} ч.`, `${forecast.chance! < 0.5 ? 'If it gets there, about' : 'About'} ${stampFormat.format(forecast.from!)} – ${stampFormat.format(forecast.to!)}. Over the past week the price reached ${formatPrice(shown)} within two days ${Math.round(forecast.chance! * 100)}% of the time, usually in ${forecast.hours} h.`)}
          {forecast.state === 'unlikely' && t(`За прошлую неделю цена почти не доходила до ${formatPrice(shown)} в течение двух суток. Выберите сумму меньше.`, `Over the past week the price hardly ever reached ${formatPrice(shown)} within two days. Choose a smaller sum.`)}
          {forecast.state === 'unknown' && t('Мало данных для прогноза.', 'Too little data for a forecast.')}
        </p>
        <p className="trading-note">{t('Прогноз по прошлым графикам, а не гарантия.', 'A forecast from past charts, not a guarantee.')}</p>
        <dl>
          <div><dt>{t('Успешные продажи за месяц', 'Successful sales in a month')}</dt><dd>{past.wins} {t('из', 'of')} {past.signals} ({Math.round(entry.reliability * 100)}%)</dd></div>
          <div><dt>{t('Обычно выгода за сделку', 'Usual profit per deal')}</dt><dd className={past.medianProfit > 0 ? 'price-up' : 'price-down'}>{money(past.medianProfit)}</dd></div>
          <div><dt>{t('Обычно ждать до продажи', 'Usual wait to sell')}</dt><dd>{past.medianHours ? t(`${Math.round(past.medianHours)} ч`, `${Math.round(past.medianHours)} h`) : t('сразу', 'none')}</dd></div>
          {row.hours && <div><dt>{t('Обычно дешевле / дороже в ваше время', 'Usually cheaper / dearer, your time')}</dt><dd>{clock(row.hours.cheap)} / {clock(row.hours.dear)}</dd></div>}
          {traderPrice > 0 && <div><dt>{t('Торговец', 'Trader')}: {uiText(traderName ?? '')}</dt><dd>{formatPrice(traderPrice)}</dd></div>}
          <div><dt>{t('Предложений на рынке обычно', 'Usual offers on the market')}</dt><dd>{entry.window.offers}</dd></div>
        </dl>
        {row.trend <= -0.1 && <p className="trading-note warn"><TrendingDown size={13} /> {t(`За сутки цена на ${Math.round(-row.trend * 100)}% ниже обычной: может падать дальше.`, `The last day is ${Math.round(-row.trend * 100)}% below usual: it may keep falling.`)}</p>}
        {row.trend >= 0.1 && <p className="trading-note"><TrendingUp size={13} /> {t(`За сутки цена на ${Math.round(row.trend * 100)}% выше обычной.`, `The last day is ${Math.round(row.trend * 100)}% above usual.`)}</p>}
      </section>
    </div>
  </div>
}

/** What the player has bought in this mode: at what price, and whether it can be sold for the chosen sum now. */
function Purchases({ positions, items, mode, fee, onOpen, locale }: { positions: TradingPosition[]; items: ReadonlyMap<string, Item>; mode: RaidMode; fee: Fee; onOpen: (id: string) => void; locale: 'ru' | 'en' }) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  if (!positions.length) return null
  return <section className="panel trading-purchases">
    <div className="panel-header"><div className="panel-title">{t('Мои покупки', 'My purchases')}</div></div>
    <ul>
      {positions.map((position) => {
        const item = items.get(position.itemId)
        const current = item ? currentPrice(item, mode) : undefined
        const offer = item ? traderOffer(item, mode) : undefined
        const status = positionStatus(position, current, offer?.price ?? 0, fee)
        return <li key={position.itemId} className={status.ready ? 'ready' : ''}>
          <button type="button" className="trading-purchase-name" onClick={() => onOpen(position.itemId)}>
            {item && <img src={item.iconUrl} alt="" loading="lazy" className="economy-thumb" />}
            <span><strong>{item ? uiText(item.name) : position.itemId}</strong><small className="dim">{t(`куплено за ${formatPrice(position.paid)}, плюс ${formatPrice(position.plus)}`, `bought at ${formatPrice(position.paid)}, to earn ${formatPrice(position.plus)}`)}</small></span>
          </button>
          <span className="trading-purchase-state">
            {status.ready
              ? <strong className="price-up">{status.route === 'trader'
                ? t(`Можно продавать: ${uiText(offer?.source ?? '')} за ${formatPrice(offer?.price ?? 0)}, ${money(status.earned ?? 0)}`, `You can sell: ${uiText(offer?.source ?? '')} at ${formatPrice(offer?.price ?? 0)}, ${money(status.earned ?? 0)}`)
                : t(`Можно продавать: выставляйте от ${formatPrice(status.ask!)}, сейчас ${money(status.earned ?? 0)}`, `You can sell: list from ${formatPrice(status.ask!)}, now ${money(status.earned ?? 0)}`)}</strong>
              : <span className="dim">{status.ask === null ? t('Эта сумма недостижима из-за комиссии', 'This sum is out of reach with the fee') : t(`Ждём цену от ${formatPrice(status.ask)}`, `Waiting for ${formatPrice(status.ask)}`)}{current ? t(`, сейчас ${formatPrice(current)}`, `, now ${formatPrice(current)}`) : ''}</span>}
          </span>
          <button type="button" className="icon-button" aria-pressed={position.notify} title={position.notify ? t('Уведомление включено', 'Notification on') : t('Уведомление выключено', 'Notification off')} aria-label={position.notify ? t('Выключить уведомление', 'Turn the notification off') : t('Включить уведомление', 'Turn the notification on')} onClick={() => savePosition({ ...position, notify: !position.notify })}>{position.notify ? <Bell size={14} /> : <BellOff size={14} />}</button>
          <button type="button" className="button ghost" onClick={() => removePosition(mode, position.itemId)}>{t('Продал', 'Sold it')}</button>
        </li>
      })}
    </ul>
  </section>
}

function RowView({ entry, expanded, bought, onToggle, children, locale }: { entry: BoardRow; expanded: boolean; bought: boolean; onToggle: () => void; children: React.ReactNode; locale: 'ru' | 'en' }) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const { window, signal } = entry
  return <>
    <tr className={`trading-row ${expanded ? 'open' : ''} ${signal ? `has-${signal.kind}` : ''}`} onClick={onToggle}>
      <td>
        <div className="trading-item">
          <img src={entry.item.iconUrl} alt="" loading="lazy" className="economy-thumb" />
          <span className="economy-line-text">
            <button type="button" className="trading-name" aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); onToggle() }}>{uiText(entry.item.name)} {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
            {(signal || bought) && <small className={signal?.kind === 'buy' ? 'price-up' : signal?.kind === 'sell' ? 'price-down' : 'dim'}>
              {signal?.kind === 'buy' ? t('можно покупать', 'can buy') : signal?.kind === 'sell' ? t('можно продавать', 'can sell') : ''}
              {signal && bought ? ' · ' : ''}{bought ? t('куплено', 'bought') : ''}
            </small>}
          </span>
        </div>
      </td>
      <td className="num mono">{formatPrice(window.min)}</td>
      <td className="num mono trading-now">{entry.current !== undefined ? <span className={signal?.kind === 'buy' ? 'price-up' : signal?.kind === 'sell' ? 'price-down' : ''}>{formatPrice(entry.current)}</span> : <span className="dim">{t('нет лотов', 'no offers')}</span>}</td>
      <td className="num mono">{formatPrice(window.max)}</td>
      <td className="num"><SalesChip entry={entry} locale={locale} /></td>
    </tr>
    {expanded && <tr className="trading-detail-row"><td colSpan={5}>{children}</td></tr>}
  </>
}

/**
 * «Торговля» in «Экономика» (owner, 05.11.2026), its own block and not the flea market's page: on top the items that swing
 * hardest, for 3 days or a week: the lowest price, the price now, the highest, the successful sales. A click opens the chart
 * with dates, hours and a forecast, and the sums: what you paid, the fee, the selling price for the sum you want. «Купил» keeps
 * it and tells when it can be sold. All of it an estimate from history (src/domain/trading.ts). Prices come every minute while
 * this page is open; the server hands out a prepared file, so 30–60 players at once cost it next to nothing.
 */
export function TradingPage() {
  const { data, source } = useTarkovData()
  const state = useAppState()
  const { locale } = useLocale()
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const mode = state.raidMode
  const progress = state.activeProfile.modes[mode]
  const stats = useTradingStats(mode)
  const live = useLivePrices(mode)
  const settings = useTradingSettings()
  const now = useMinuteClock()
  const allPositions = useAllPositions()
  const positions = useMemo(() => allPositions.filter((position) => position.mode === mode), [allPositions, mode])
  const [params, setParams] = useSearchParams()
  const [period, setPeriod] = useState<TradingPeriod>(7)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | TradingKind>('all')
  const [sort, setSort] = useState<SortKey>('swing')
  const [allBuys, setAllBuys] = useState(false)
  const [allSells, setAllSells] = useState(false)
  const [allRows, setAllRows] = useState(false)
  const selected = params.get('item')
  const snapshot = stats.data ?? null
  // The statistics' items and the player's purchases, at this minute's prices.
  const items = useMemo(() => {
    const wanted = new Set([...(snapshot?.rows.map((row: TradingRow) => row.id) ?? []), ...positions.map((position) => position.itemId)])
    return new Map(data.items.filter((item) => wanted.has(item.id)).map((item) => [item.id, withLivePrice(item, mode, live)]))
  }, [data.items, live, mode, positions, snapshot])
  const level = knownLevel(progress)
  const fee = useMemo(() => feeOptionsFor(snapshot ?? { fee: { offerFeeRate: 0.05, requirementFeeRate: 0.05 } }, data.hideout, progress.hideoutLevels), [data.hideout, progress.hideoutLevels, snapshot])
  // Demo prices or a catalog that has not come yet: zeros here would read as «nothing to trade».
  const pricesReady = source !== 'demo' && (!snapshot?.rows.length || items.size > 0)
  const rows = useMemo(() => snapshot && pricesReady ? boardRows({ snapshot, items, mode, period, fee, playerLevel: level, now }) : [], [fee, items, level, mode, now, period, pricesReady, snapshot])
  const open = (id: string) => setParams((current) => {
    const next = new URLSearchParams(current)
    if (next.get('item') === id) next.delete('item')
    else next.set('item', id)
    return next
  }, { replace: true })
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase()
    return rows
      .filter((row) => kind === 'all' || row.row.kind === kind)
      .filter((row) => !words || `${row.item.name} ${row.item.shortName} ${uiText(row.item.name)} ${uiText(row.item.shortName)}`.toLowerCase().includes(words))
      .sort((a, b) => sorters[sort](b) - sorters[sort](a))
  }, [kind, query, rows, sort])
  // A signal or a message opens its item wherever it stands: past the first rows, or filtered out by the search.
  const opened = useMemo(() => rows.find((row) => row.row.id === selected), [rows, selected])
  const visible = useMemo(() => {
    const list = allRows ? shown : shown.slice(0, ROWS_SHOWN)
    return opened && !list.includes(opened) ? [opened, ...list] : list
  }, [allRows, opened, shown])
  const openedId = opened?.row.id
  useEffect(() => {
    if (openedId) document.querySelector('.trading-row.open')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [openedId])
  const buys = useMemo(() => shown.filter((row) => row.signal?.kind === 'buy').sort((a, b) => b.signal!.profit - a.signal!.profit), [shown])
  const sells = useMemo(() => shown.filter((row) => row.signal?.kind === 'sell').sort((a, b) => b.signal!.profit - a.signal!.profit), [shown])
  const modeName = mode === 'seasonal' ? t('Сезон', 'Season') : mode.toUpperCase()
  const stale = snapshot ? tradingStale(snapshot, now) : false
  const hoursAgo = snapshot ? Math.max(0, Math.round((now - Date.parse(snapshot.builtAt)) / 3_600_000)) : 0
  const lastPrices = live?.updatedAt ? new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(live.updatedAt) : null

  return <div className="page trading-page">
    <header className="page-header">
      <div>
        <div className="eyebrow">{t('Экономика · ', 'Economy · ')}{modeName}</div>
        <h1 className="page-title">{t('Торговля', 'Trading')}</h1>
        <p className="page-subtitle">{t('Купить дешевле, продать дороже. Оценка по истории цен, не гарантия.', 'Buy low, sell high. An estimate from price history, not a guarantee.')}</p>
      </div>
      {snapshot && <span className={`tag ${stale ? 'danger' : 'green'}`}>{hoursAgo ? t(`статистика: ${hoursAgo} ч назад`, `statistics: ${hoursAgo} h ago`) : t('статистика свежая', 'statistics are fresh')}</span>}
    </header>

    {stats.isLoading && <div className="panel economy-loading" aria-busy="true">{t('Загружаю статистику…', 'Loading the statistics…')}</div>}
    {!stats.isLoading && !snapshot && <div className="panel import-warning"><AlertTriangle size={17} />{t('Статистика по этому режиму ещё собирается. Сервер считает её несколько раз в день, в первый раз это занимает около часа.', 'The statistics for this mode are still being gathered. The server builds them a few times a day; the first time takes about an hour.')}</div>}
    {stale && <div className="panel import-warning"><AlertTriangle size={17} />{t('Статистика устарела: сигналы выключены, пока сервер её не обновит.', 'The statistics are out of date: signals are off until the server renews them.')}</div>}

    {snapshot && level !== undefined && level < MARKET_LEVEL && <div className="panel import-warning"><AlertTriangle size={17} />{t(`Барахолка откроется на ${MARKET_LEVEL} уровне, сейчас у вас ${level}. Здесь показывается только то, что можно купить и продать на вашем уровне.`, `The flea market opens at level ${MARKET_LEVEL}, you are level ${level}. Only what you can buy and sell at your level is shown here.`)}</div>}
    {snapshot && level === undefined && <div className="panel import-warning"><AlertTriangle size={17} />{t('Уровень персонажа в этом режиме ещё не определён, поэтому показаны все предметы и уведомления о сигналах выключены. Часть предметов может быть закрыта на барахолке.', 'Your level in this mode is not known yet, so all items are shown and signal notifications are off. Some items may be closed to you on the flea market.')}</div>}

    {snapshot && !pricesReady && <div className="panel economy-loading" aria-busy="true">{t('Жду актуальные цены…', 'Waiting for current prices…')}</div>}

    {snapshot && pricesReady && <>
      <Purchases positions={positions} items={items} mode={mode} fee={fee} onOpen={open} locale={locale} />

      <section className="panel trading-top">
        <div className="panel-header economy-toolbar">
          <div className="mode-switch" role="group" aria-label={t('Период', 'Period')}>
            <button type="button" className={period === 3 ? 'active' : ''} onClick={() => setPeriod(3)}>{t('Цена за 3 дн.', 'Price for 3 days')}</button>
            <button type="button" className={period === 7 ? 'active' : ''} onClick={() => setPeriod(7)}>{t('Цена за неделю', 'Price for a week')}</button>
          </div>
          <div className="filter-row">
            <div className="economy-search"><Search size={14} /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Поиск предмета…', 'Search for an item…')} aria-label={t('Поиск предмета', 'Search for an item')} /></div>
            <select className="select" value={kind} aria-label={t('Вид предмета', 'Item kind')} onChange={(event) => setKind(event.target.value as typeof kind)}>{KINDS.map((entry) => <option key={entry.key} value={entry.key}>{locale === 'en' ? entry.en : entry.ru}</option>)}</select>
            <select className="select" value={sort} aria-label={t('Сортировка', 'Sorting')} onChange={(event) => setSort(event.target.value as SortKey)}>{SORTS.map((entry) => <option key={entry.key} value={entry.key}>{locale === 'en' ? entry.en : entry.ru}</option>)}</select>
          </div>
        </div>
        <div className="economy-table-wrap">
          <table className="price-table economy-table trading-table">
            <thead><tr>
              <th>{t('Предмет', 'Item')}</th>
              <th className="num">{t('Минимум', 'Low')}</th>
              <th className="num">{t('Сейчас', 'Now')}</th>
              <th className="num">{t('Максимум', 'High')}</th>
              <th className="num" title={t('По истории цен за месяц: сколько покупок на падении закончились в плюс. Оценка, а не реальные сделки.', 'From the past month’s price history: how many buys on a dip ended in profit. An estimate, not actual deals.')}>{t('Успешные продажи', 'Successful sales')}</th>
            </tr></thead>
            <tbody>
              {visible.map((entry) => {
                const position = positions.find((row) => row.itemId === entry.row.id)
                return <RowView key={entry.row.id} entry={entry} expanded={selected === entry.row.id} bought={Boolean(position)} onToggle={() => open(entry.row.id)} locale={locale}>
                  <ItemDetail entry={entry} period={period} position={position} fee={fee} mode={mode} now={now} locale={locale} />
                </RowView>
              })}
              {visible.length === 0 && <tr><td colSpan={5} className="muted">{t('Под этот отбор ничего не подходит.', 'Nothing matches this filter.')}</td></tr>}
            </tbody>
          </table>
        </div>
        {shown.length > ROWS_SHOWN && <button type="button" className="button ghost trading-more" onClick={() => setAllRows((value) => !value)}>{allRows ? t('Свернуть', 'Show fewer') : t(`Показать все: ${shown.length}`, `Show all: ${shown.length}`)}</button>}
        <p className="trading-summary dim">
          {level !== undefined ? t(`Открыто на вашем ${level} уровне: ${rows.length}.`, `Open at your level ${level}: ${rows.length}.`) : t(`Предметов: ${rows.length}.`, `Items: ${rows.length}.`)}
          {' '}{t('Цены обновляются сами раз в минуту, пока открыт этот раздел', 'Prices renew by themselves every minute while this section is open')}{lastPrices ? t(`, последнее обновление ${lastPrices}.`, `, last at ${lastPrices}.`) : '.'}
          {' '}{t(`Комиссия при продаже ${Math.round((snapshot.fee.offerFeeRate ?? 0.05) * 100)}%, покупка без комиссии.`, `Selling fee ${Math.round((snapshot.fee.offerFeeRate ?? 0.05) * 100)}%, buying has no fee.`)}
        </p>
      </section>

      <div className="trading-signals-head">
        <label className="trading-notify">
          <span className="economy-check"><input type="checkbox" checked={settings.enabled} onChange={(event) => writeTradingSettings({ enabled: event.target.checked })} /><BellRing size={13} /> {t('Уведомлять о сигналах', 'Notify about signals')}</span>
          <select className="select" disabled={!settings.enabled} value={settings.minProfit} aria-label={t('Уведомлять от такой выгоды', 'Notify from this profit')} onChange={(event) => writeTradingSettings({ minProfit: Number(event.target.value) })}>
            {TRADING_PROFIT_STEPS.map((step) => <option key={step} value={step}>{t('от', 'from')} {formatPrice(step)}</option>)}
          </select>
        </label>
      </div>
      <div className="trading-signals">
        <section className="panel">
          <div className="panel-header"><div className="panel-title"><ArrowDownCircle size={15} className="price-up" /> {t('Цена упала: можно покупать', 'Price fell: you can buy')}</div><span className="dim">{buys.length}</span></div>
          <div className="trading-signal-list">
            {buys.length === 0 && <p className="muted trading-empty">{t('Сейчас ничего не упало к минимуму.', 'Nothing is near its low right now.')}</p>}
            {(allBuys ? buys : buys.slice(0, SIGNALS_SHOWN)).map((entry) => <SignalCard key={entry.row.id} entry={entry} locale={locale} onOpen={() => open(entry.row.id)} />)}
          </div>
          {buys.length > SIGNALS_SHOWN && <button type="button" className="button ghost trading-more" onClick={() => setAllBuys((value) => !value)}>{allBuys ? t('Свернуть', 'Show fewer') : t(`Показать все: ${buys.length}`, `Show all: ${buys.length}`)}</button>}
        </section>
        <section className="panel">
          <div className="panel-header"><div className="panel-title"><ArrowUpCircle size={15} className="price-down" /> {t('Цена выросла: можно продавать', 'Price is up: you can sell')}</div><span className="dim">{sells.length}</span></div>
          <div className="trading-signal-list">
            {sells.length === 0 && <p className="muted trading-empty">{t('Сейчас ничего не поднялось к максимуму.', 'Nothing is near its high right now.')}</p>}
            {(allSells ? sells : sells.slice(0, SIGNALS_SHOWN)).map((entry) => <SignalCard key={entry.row.id} entry={entry} locale={locale} onOpen={() => open(entry.row.id)} />)}
          </div>
          {sells.length > SIGNALS_SHOWN && <button type="button" className="button ghost trading-more" onClick={() => setAllSells((value) => !value)}>{allSells ? t('Свернуть', 'Show fewer') : t(`Показать все: ${sells.length}`, `Show all: ${sells.length}`)}</button>}
        </section>
      </div>

      <section className="panel trading-howto">
        <div className="panel-header"><div className="panel-title"><Info size={14} /> {t('Как читать эти цифры', 'How to read these numbers')}</div></div>
        <ul>
          <li>{t('Цена здесь: самая низкая на барахолке, а не средняя. По ней можно купить, и её надо перебить, чтобы продать. Проверка с одним-двумя предложениями не считается: это разовые лоты.', 'A price here is the lowest on the flea market, not the average: you can buy at it, and you have to undercut it to sell. A check with one or two offers does not count: those are lone listings.')}</li>
          <li>{t('Успешные продажи: сколько покупок на падении за прошлый месяц закончились бы в плюс, считая покупку по следующей проверке цены и продажу в течение двух суток. Это оценка по истории, данных о реальных сделках нет.', 'Successful sales: how many buys on a dip over the past month would have ended in profit, counting the purchase at the next price check and the sale within two days. An estimate from history: there is no data on actual deals.')}</li>
          <li>{t('Цены приходят с задержкой до полутора часов: дешёвого лота к этому времени может уже не быть.', 'Prices arrive up to an hour and a half late: the cheap listing may be gone by then.')}</li>
          <li>{t('Лот может не продаться: комиссия не вернётся, а репутация барахолки упадёт. Число своих лотов тоже ограничено репутацией.', 'A listing may not sell: the fee is not returned and flea reputation falls. Reputation also limits how many listings you can have.')}</li>
          <li>{t('Предметы, у которых копии бывают разными, здесь не рассматриваются: оружие, броня, шлемы, ключи, аптечки, лекарства на несколько применений, вода, топливо, фильтры, ремонтные наборы. Самый дешёвый такой лот часто неполный, и его цена говорит об износе, а не о рынке.', 'Items whose copies differ are not looked at here: weapons, armor, helmets, keys, medkits, medicine of several uses, water, fuel, filters, repair kits. The cheapest such listing is often not a whole one, and its price tells about wear, not the market.')}</li>
          <li>{t('Показано только то, что барахолка открывает на вашем уровне в этом режиме: и для покупки, и для продажи.', 'Only what the flea market opens at your level in this mode is shown: both to buy and to sell.')}</li>
          <li>{t('Купленное на барахолке не считается «найдено в рейде»: для квестов и убежища, где это нужно, такой предмет не подойдёт.', 'What you buy on the flea market is not «found in raid»: it will not do for quests and hideout levels that ask for it.')}</li>
        </ul>
      </section>
    </>}
  </div>
}
