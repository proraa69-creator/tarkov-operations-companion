import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowDown, ArrowDownCircle, ArrowUp, ArrowUpCircle, Bell, BellOff, BellRing, Check, ChevronDown, ChevronUp, Info, MousePointerClick, Search, TrendingDown, TrendingUp, X } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useLivePrices, withLivePrice } from '../data/livePrices'
import { useTradingStats } from '../data/tradingApi'
import { fleaMarketFee, type FleaFeeOptions } from '../domain/fleaFee'
import { fleaRenewedAt } from '../domain/itemPrices'
import { askForNet, fleaNet, floorForAsk, MARKET_LEVEL, moduleDeal, openAtLevel, peakForecast, reliabilityTier, rowScans, sellForecast, tradingStale, type ModuleDeal, type TraderOffer, type TradingKind, type TradingModule, type TradingRow } from '../domain/trading'
import type { Item, RaidMode } from '../domain/types'
import { useTraderLevels } from '../gunsmith/traderLevels'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { questAvailabilityOf } from '../quests/questReadModel'
import { formatPrice } from '../shared/format'
import { useAppState } from '../state/AppState'
import { TradingChart } from '../trading/TradingChart'
import { useSteadyOrder } from '../trading/steadyOrder'
import { boardRows, currentPrice, feeOptionsFor, freshestFirst, justRenewed, knownLevel, priceTooOld, signalsFirst, sortByValue, sortRows, sortSales, traderOffer, traderSales, type BoardRow, type SaleSortKey, type TableSort, type TraderSale, type TradingPeriod, type TradingSortKey } from '../trading/tradingBoard'
import { useMinuteClock } from '../trading/tradingClock'
import { positionStatus, removePosition, savePosition, useAllPositions, type PositionStatus, type TradingPosition } from '../trading/tradingPositions'
import { TRADING_PROFIT_STEPS, useTradingSettings, writeTradingSettings } from '../trading/tradingSettings'
import '../styles/economy.css'
import '../styles/trading.css'

type Fee = Omit<FleaFeeOptions, 'count'>
type Locale = 'ru' | 'en'
type View = 'list' | 'bought' | 'modules' | 'traders'
type History = Pick<TradingRow, 'series' | 'seriesFrom' | 'seriesAt'>
const SIGNALS_SHOWN = 6
const HOWTO_KEY = 'raidos-trading-howto-v1'
/** The top of the window: the signals stay in sight under it. */
const ROWS_SHOWN = 15
const boardRowId = (entry: BoardRow) => entry.row.id
const moduleEntryId = (entry: ModuleEntry) => entry.module.id
const purchaseId = (entry: PurchaseEntry) => entry.position.itemId

const KINDS: Array<{ key: 'all' | TradingKind; ru: string; en: string }> = [
  { key: 'all', ru: 'Всё', en: 'All' },
  { key: 'barter', ru: 'Бартер', en: 'Barter' },
  { key: 'gear', ru: 'Снаряжение', en: 'Gear' },
  { key: 'other', ru: 'Прочее', en: 'Other' },
]

const percent = (value: number, digits = 0) => `${value > 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`
const money = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatPrice(Math.abs(Math.round(value)))}`
const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value)
const digits = (text: string) => Number(text.replace(/\D/g, '')) || 0
const cleanDigits = (text: string) => text.replace(/[^\d\s]/g, '')

const CLOCKS: Record<Locale, Intl.DateTimeFormat> = {
  ru: new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  en: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }),
}

function ageText(ms: number, locale: Locale) {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return locale === 'en' ? 'just now' : 'только что'
  const hours = Math.floor(minutes / 60)
  if (!hours) return locale === 'en' ? `${minutes} min ago` : `${minutes} мин назад`
  return locale === 'en' ? `${hours} h ${minutes % 60} min ago` : `${hours} ч ${minutes % 60} мин назад`
}

/** The owner, 06.11.2026: «сделай еще колонку по актуальности цены… насколько свежая цена». Green while it has only just come. */
function PriceAge({ at, clock, locale }: { at: number | undefined; clock: number; locale: Locale }) {
  if (at === undefined) return <td className="num dim trading-age">—</td>
  return <td className={`num trading-age ${justRenewed(at, clock) ? 'is-fresh' : ''}`} title={`${locale === 'en' ? 'Updated at' : 'Обновлена в'} ${CLOCKS[locale].format(at)}`}>{ageText(clock - at, locale)}</td>
}

/**
 * The price beside it, lit the same way (owner: «должна высвечиваться цена актуальная. И подсвечиваю ее зеленым»). The phone has no
 * room for the column: the age stands under the price there, by CSS from `data-age`.
 */
const priceCell = (at: number | undefined, clock: number, locale: Locale) => ({
  className: `num mono trading-now ${justRenewed(at, clock) ? 'is-fresh' : ''}`,
  ...(at !== undefined ? { 'data-age': ageText(clock - at, locale) } : {}),
})

/** The headings of a table: the first click sorts by it, the second turns it round, the third comes back to the freshest first. */
function useColumnSort<K extends string>(fresh: K) {
  const [sort, setSort] = useState<TableSort<K>>({ key: fresh, dir: 1 })
  const onSort = useCallback((key: K) => setSort((current) => {
    if (current.key !== key) return { key, dir: 1 }
    if (key === fresh) return { key, dir: current.dir === 1 ? -1 : 1 }
    return current.dir === 1 ? { key, dir: -1 } : { key: fresh, dir: 1 }
  }), [fresh])
  return [sort, onSort] as const
}

/** Successful sales, as the owner asked: of the past month's dips, how many ended in profit. */
function SalesChip({ entry, locale }: { entry: BoardRow; locale: Locale }) {
  const { wins, signals } = entry.row.backtest
  return <span className={`trading-chip ${reliabilityTier(entry.row.backtest)}`} title={locale === 'en'
    ? `In the past month's price history ${wins} of ${signals} buys on a dip ended in profit. An estimate, not actual deals.`
    : `По истории цен за месяц ${wins} из ${signals} покупок на падении закончились в плюс. Оценка, а не реальные сделки.`}>{wins}/{signals}</span>
}

function SignalCard({ entry, onOpen, onContext, locale }: { entry: BoardRow; onOpen: () => void; onContext: (event: React.MouseEvent) => void; locale: Locale }) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const signal = entry.signal!
  return <button type="button" className={`trading-signal ${signal.kind}`} onClick={onOpen} onContextMenu={onContext}>
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

/** The highest price a period saw, to hold the player's sum against: what the list's «Максимум» shows. */
interface PriceLimit { high: number; period: TradingPeriod }

const periodWords = (period: TradingPeriod, locale: Locale) => locale === 'en' ? (period === 3 ? 'in 3 days' : 'in a week') : (period === 3 ? 'за 3 дня' : 'за неделю')

/**
 * The sum as a slider (owner, 05.11.2026: «сделай ползунок… не просто поэтапно… от 0 там, до 100 тысяч»), green up to what the
 * price has really reached, red above it («подсвечивается красным и говорит, что это дорого для этого предмета»). The scale
 * is at least 100 000 ₽ and grows with a dear item, the field takes any sum.
 */
function PlusSlider({ plus, onChange, best, locale }: { plus: number; onChange: (plus: number) => void; best?: number; locale: Locale }) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const reach = Math.max(0, best ?? 0)
  const top = Math.max(100_000, Math.ceil((Math.max(reach * 1.5, plus)) / 10_000) * 10_000)
  const step = top > 500_000 ? 5_000 : top > 200_000 ? 2_000 : 1_000
  const green = best === undefined ? 100 : Math.min(100, (reach / top) * 100)
  const over = best !== undefined && plus > 0 && plus > reach
  return <div className={`trading-plus ${over ? 'over' : ''}`} role="group" aria-label={t('Сколько хотите заработать', 'How much you want to earn')}>
    <div className="trading-plus-head">
      <span>{t('Сколько хотите заработать', 'How much you want to earn')}</span>
      <input className="input mono trading-plus-sum" inputMode="numeric" value={number(plus)} aria-label={t('Своя сумма', 'Your own sum')} onChange={(event) => onChange(digits(event.target.value))} />
    </div>
    <input type="range" className="trading-slider" min={0} max={top} step={step} value={Math.min(plus, top)} style={{ '--green': `${green}%` } as React.CSSProperties} aria-label={t('Сколько хотите заработать', 'How much you want to earn')} aria-valuetext={formatPrice(plus)} onChange={(event) => onChange(Number(event.target.value))} />
    <div className="trading-scale dim mono"><span>0</span><span>{number(top)}</span></div>
  </div>
}

/**
 * Under the sum, in a frame (owner: «показываю, сколько реально можно будет уйти в плюс. Должна подсвечиваться зеленым. Снизу
 * рамка»): what the period's highest price would leave after the fee. An estimate, and nothing says the price comes back.
 */
function RealPlus({ limit, best, locale }: { limit: PriceLimit; best: number; locale: Locale }) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const words = periodWords(limit.period, locale)
  if (best <= 0) return <div className="trading-real none">
    <strong>{t('По истории в плюс не выйти', 'History shows no plus at this price')}</strong>
    <small>{t(`Самая высокая цена ${words}: ${formatPrice(limit.high)}. После комиссии это меньше, чем вы заплатили.`, `The highest price ${words}: ${formatPrice(limit.high)}. After the fee that is less than you paid.`)}</small>
  </div>
  return <div className="trading-real">
    <span>{t('Реально можно заработать', 'You can really earn')}</span>
    <strong className="mono">{t('до', 'up to')} {money(best)}</strong>
    <small>{t(`При цене ${formatPrice(limit.high)}, самой высокой ${words}.`, `At ${formatPrice(limit.high)}, the highest ${words}.`)}</small>
  </div>
}

/** What the highest price of the period leaves of what the player paid. */
const bestPlus = (base: number, limit: PriceLimit | undefined, paid: number, fee: Fee) => limit ? fleaNet(base, limit.high, fee) - paid : undefined

interface Source { id: string; base: number; defaultPaid: number; traderName?: string; traderPrice: number; limit?: PriceLimit }

/** The player's sum, the fee it costs and the listing that earns it; «Купил» sends it to «Куплено». */
function SaleCalculator({ source, position, fee, mode, target, setTarget, onBought, locale }: {
  source: Source
  position?: TradingPosition
  fee: Fee
  mode: RaidMode
  target?: number
  setTarget: (price: number | undefined) => void
  onBought: () => void
  locale: Locale
}) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const [paidText, setPaidText] = useState(position ? String(position.paid) : '')
  const [plus, setPlus] = useState(position?.plus ?? 0)
  const paid = digits(paidText) || source.defaultPaid
  const breakEven = askForNet(source.base, paid, fee)
  const ask = askForNet(source.base, paid + plus, fee)
  const needed = ask === null ? undefined : floorForAsk(ask)
  useEffect(() => { if (needed !== target) setTarget(needed) }, [needed, setTarget, target])
  const askFee = ask === null ? 0 : fleaMarketFee(source.base, ask, fee)
  const best = bestPlus(source.base, source.limit, paid, fee)
  const tooDear = best !== undefined && plus > 0 && plus > Math.max(0, best)
  return <section className="trading-calc">
    <label className="trading-field">
      <span>{t('За сколько купили', 'What you paid')}</span>
      <input className="input mono" inputMode="numeric" value={paidText} placeholder={formatPrice(paid)} aria-label={t('За сколько купили', 'What you paid')} onChange={(event) => setPaidText(cleanDigits(event.target.value))} />
    </label>
    <dl>
      <div><dt>{t('Минимальная цена продажи, чтобы выйти в плюс', 'Lowest selling price to come out ahead')}</dt><dd className="mono">{breakEven === null ? t('нет такой', 'none') : formatPrice(breakEven)}</dd></div>
      <div><dt>{t('Комиссия при этой цене', 'Fee at that price')}{fee.intelCenterLevel && fee.intelCenterLevel >= 3 ? t(' (Разведцентр 3 ур.: −30%)', ' (Intelligence Center 3: −30%)') : ''}</dt><dd className="mono price-down">{breakEven === null ? '—' : `−${formatPrice(fleaMarketFee(source.base, breakEven, fee))}`}</dd></div>
    </dl>
    <PlusSlider plus={plus} onChange={setPlus} {...(best !== undefined ? { best } : {})} locale={locale} />
    {ask === null
      ? <p className="trading-result none">{t(`Комиссия не даст заработать ${formatPrice(plus)} при покупке за ${formatPrice(paid)}: чем выше цена, тем больше она съедает. Выберите сумму меньше.`, `The fee will not let you earn ${formatPrice(plus)} on ${formatPrice(paid)}: the higher the price, the more it takes. Choose a smaller sum.`)}</p>
      : <div className={`trading-result ${tooDear ? 'dear' : ''}`}>
          <span>{t('Нужно продать за', 'Sell at')}</span>
          <strong className="mono">{formatPrice(ask)}</strong>
          <small>{t(`Комиссия ${formatPrice(askFee)}, останется ${formatPrice(ask - askFee)}, плюс ${formatPrice(ask - askFee - paid)}. Это когда самая низкая цена на рынке от ${formatPrice(needed!)}.`, `Fee ${formatPrice(askFee)}, ${formatPrice(ask - askFee)} left, ${formatPrice(ask - askFee - paid)} earned. That is when the lowest price on the market is ${formatPrice(needed!)} or more.`)}</small>
        </div>}
    {tooDear && source.limit && <p className="trading-dear"><AlertTriangle size={13} /> {t(`Дорого для этого предмета: ${periodWords(source.limit.period, locale)} цена не поднималась выше ${formatPrice(source.limit.high)}.`, `Too much for this item: ${periodWords(source.limit.period, locale)} the price did not go above ${formatPrice(source.limit.high)}.`)}</p>}
    {source.limit && best !== undefined && <RealPlus limit={source.limit} best={best} locale={locale} />}
    {source.traderPrice > paid && <p className="trading-note">{t(`Или сразу торговцу: ${uiText(source.traderName ?? '')} платит ${formatPrice(source.traderPrice)}, это ${money(source.traderPrice - paid)}.`, `Or to a trader at once: ${uiText(source.traderName ?? '')} pays ${formatPrice(source.traderPrice)}, that is ${money(source.traderPrice - paid)}.`)}</p>}
    <div className="trading-buy">
      {position
        ? <button type="button" className="button" onClick={onBought}><Check size={14} /> {t('Куплено: открыть', 'Bought: open')}</button>
        : <>
            <button type="button" className="button primary" onClick={() => { savePosition({ mode, itemId: source.id, paid, plus, notify: true, base: source.base, boughtAt: Date.now() }); onBought() }}><Check size={14} /> {t('Купил', 'Bought it')}</button>
            <span className="trading-note">{t('Уведомление о старте продажи включится само.', 'The notification about the start of selling turns on by itself.')}</span>
          </>}
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

function ForecastText({ history, target, current, now, locale }: { history: History; target: number; current?: number; now: number; locale: Locale }) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const forecast = useMemo(() => sellForecast(rowScans(history), target, current, now), [current, history, now, target])
  const stamp = useMemo(() => new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), [locale])
  return <>
    <h4>{t('Прогноз, когда можно будет продавать', 'Forecast: when you can sell')}</h4>
    <p className="trading-forecast-text">
      {forecast.state === 'now' && t(`Можно продавать сейчас: самая низкая цена уже от ${formatPrice(target)}.`, `You can sell now: the lowest price is already ${formatPrice(target)} or more.`)}
      {forecast.state === 'window' && t(`${forecast.chance! < 0.5 ? 'Если дойдёт, то примерно' : 'Примерно'} ${stamp.format(forecast.from!)} – ${stamp.format(forecast.to!)}. За прошлую неделю цена доходила до ${formatPrice(target)} в течение двух суток в ${Math.round(forecast.chance! * 100)}% случаев, обычно за ${forecast.hours} ч.`, `${forecast.chance! < 0.5 ? 'If it gets there, about' : 'About'} ${stamp.format(forecast.from!)} – ${stamp.format(forecast.to!)}. Over the past week the price reached ${formatPrice(target)} within two days ${Math.round(forecast.chance! * 100)}% of the time, usually in ${forecast.hours} h.`)}
      {forecast.state === 'unlikely' && t(`За прошлую неделю цена почти не доходила до ${formatPrice(target)} в течение двух суток. Выберите сумму меньше.`, `Over the past week the price hardly ever reached ${formatPrice(target)} within two days. Choose a smaller sum.`)}
      {forecast.state === 'unknown' && t('Мало данных для прогноза.', 'Too little data for a forecast.')}
    </p>
    <p className="trading-note">{t('Прогноз по прошлым графикам, а не гарантия.', 'A forecast from past charts, not a guarantee.')}</p>
  </>
}

/** What the mouse does here (owner, 05.11.2026: «покажи, что правой кнопкой можно нажать «Купить», либо по щелчку откроется график»), until it is closed. */
function HowTo({ locale, chart }: { locale: Locale; chart: boolean }) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const [closed, setClosed] = useState(() => {
    try { return Boolean(window.localStorage.getItem(HOWTO_KEY)) } catch { return false }
  })
  if (closed) return null
  return <div className="panel trading-mouse" role="note">
    <MousePointerClick size={17} aria-hidden="true" />
    <ul>
      {chart && <li><strong>{t('Левая кнопка', 'Left click')}</strong>: {t('график, прогноз и сколько заработать.', 'chart, forecast and how much you can earn.')}</li>}
      <li><strong>{t('Правая кнопка', 'Right click')}</strong>: {t('«Купил». Уведомление о продаже включится само.', '«Bought it». The selling notification turns on by itself.')}</li>
    </ul>
    <button type="button" className="icon-button" aria-label={t('Скрыть подсказку', 'Hide the tip')} onClick={() => { try { window.localStorage.setItem(HOWTO_KEY, '1') } catch { /* hidden for this visit */ } setClosed(true) }}><X size={14} /></button>
  </div>
}

/** A click on an item of the list: the chart with its forecast, the sums under it. */
function ItemDetail({ entry, period, position, fee, mode, now, onBought, locale }: { entry: BoardRow; period: TradingPeriod; position?: TradingPosition; fee: Fee; mode: RaidMode; now: number; onBought: () => void; locale: Locale }) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const { ref, width } = useVisibleWidth()
  const { row, current, traderPrice, traderName } = entry
  const [target, setTarget] = useState<number | undefined>(undefined)
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
      <SaleCalculator source={{ id: row.id, base: row.base, defaultPaid: current ?? row.buyBelow, ...(traderName ? { traderName } : {}), traderPrice, limit: { high: entry.window.max, period: entry.window === row.w3 ? 3 : 7 } }} position={position} fee={fee} mode={mode} target={target} setTarget={setTarget} onBought={onBought} locale={locale} />
      <section className="trading-forecast">
        <ForecastText history={row} target={target ?? row.sellAbove} current={current} now={now} locale={locale} />
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

/** The player's own clock: Intl takes the time zone of this computer. */
function useStamp(locale: Locale) {
  return useMemo(() => new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), [locale])
}

const inHours = (hours: number, locale: Locale) => {
  const whole = Math.max(1, Math.round(hours))
  return locale === 'en' ? `in ${whole} h` : `через ${whole} ч`
}

/** A click on a purchase: everything about it, and its notifications to set. */
function PurchaseDetail({ position, status, item, history, week, trader, fee, period, now, locale }: {
  position: TradingPosition
  status: PositionStatus
  item?: Item
  history?: History
  week?: TradingModule['w7']
  trader?: { source: string; price: number }
  fee: Fee
  period: TradingPeriod
  now: number
  locale: Locale
}) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const { ref, width } = useVisibleWidth()
  const limit: PriceLimit | undefined = week ? { high: week.max, period: 7 } : undefined
  const [paidText, setPaidText] = useState(String(position.paid))
  const [alertText, setAlertText] = useState(position.alertPrice ? String(position.alertPrice) : '')
  const current = item ? currentPrice(item, position.mode) : undefined
  const update = (patch: Partial<TradingPosition>) => savePosition({ ...position, ...patch })
  const setAlert = (price: number) => {
    setAlertText(price ? String(price) : '')
    const rest: TradingPosition = { mode: position.mode, itemId: position.itemId, paid: position.paid, plus: position.plus, notify: position.notify, boughtAt: position.boughtAt, base: position.base }
    savePosition(price ? { ...rest, alertPrice: price } : rest)
  }
  const target = status.ask === null ? undefined : floorForAsk(status.ask)
  const stamp = useStamp(locale)
  const peak = useMemo(() => history ? peakForecast(rowScans(history), now) : null, [history, now])
  return <div className="trading-detail" ref={ref} style={{ width }}>
    {history && history.series.length >= 2 && <TradingChart row={history} period={period} current={current} target={target} trader={trader?.price} now={now} width={width - 28} locale={locale} />}
    <div className="trading-detail-grid">
      <section className="trading-calc">
        <label className="trading-field">
          <span>{t('За сколько купили', 'What you paid')}</span>
          <input className="input mono" inputMode="numeric" value={paidText} aria-label={t('За сколько купили', 'What you paid')} onChange={(event) => { setPaidText(cleanDigits(event.target.value)); if (digits(event.target.value) > 0) update({ paid: digits(event.target.value) }) }} />
        </label>
        <PlusSlider plus={position.plus} onChange={(plus) => update({ plus })} {...(limit ? { best: bestPlus(position.base, limit, position.paid, fee) ?? 0 } : {})} locale={locale} />
        {limit && position.plus > 0 && position.plus > Math.max(0, bestPlus(position.base, limit, position.paid, fee) ?? 0) && <p className="trading-dear"><AlertTriangle size={13} /> {t(`Дорого для этого предмета: ${periodWords(limit.period, locale)} цена не поднималась выше ${formatPrice(limit.high)}.`, `Too much for this item: ${periodWords(limit.period, locale)} the price did not go above ${formatPrice(limit.high)}.`)}</p>}
        {limit && <RealPlus limit={limit} best={bestPlus(position.base, limit, position.paid, fee) ?? 0} locale={locale} />}
        <label className="economy-check trading-notify-line"><input type="checkbox" checked={position.notify} onChange={(event) => update({ notify: event.target.checked })} /> {t('Уведомлять, когда можно продавать с этим плюсом', 'Notify when it can be sold with this plus')}</label>
        <label className="trading-field">
          <span>{t('Ещё уведомить, когда цена дойдёт до', 'Also notify when the price reaches')}</span>
          <input className="input mono" inputMode="numeric" value={alertText} placeholder={t('не задано', 'not set')} aria-label={t('Ещё уведомить, когда цена дойдёт до', 'Also notify when the price reaches')} onChange={(event) => setAlert(digits(event.target.value))} />
        </label>
        {week && <div className="trading-buy">
          <button type="button" className="button ghost" onClick={() => setAlert(week.p90)}>{t('Обычный верх', 'Usual high')} {formatPrice(week.p90)}</button>
          <button type="button" className="button ghost" onClick={() => setAlert(week.max)}>{t('Максимум недели', 'Week’s high')} {formatPrice(week.max)}</button>
          {position.alertPrice && <button type="button" className="button ghost" onClick={() => setAlert(0)}>{t('Убрать', 'Remove')}</button>}
        </div>}
      </section>
      <section className="trading-forecast">
        {peak && <div className="trading-peak">
          <span>{t('Предположительно высокая цена', 'Probably a high price')}</span>
          <strong className="mono">{stamp.format(peak.at)}</strong>
          <small>{t(`${inHours(peak.hours, locale)}, ваше время, около ${formatPrice(peak.price)}. Прогноз, не гарантия.`, `${inHours(peak.hours, locale)}, your time, about ${formatPrice(peak.price)}. A forecast, not a guarantee.`)}</small>
        </div>}
        <dl>
          <div><dt>{t('Куплено за', 'Paid')}</dt><dd className="mono">{formatPrice(position.paid)}</dd></div>
          <div><dt>{t('Чтобы выйти в ноль, выставить за', 'To break even, list at')}</dt><dd className="mono">{status.zeroAsk === null ? t('нет такой цены', 'no such price') : `${formatPrice(status.zeroAsk)} (${t('комиссия', 'fee')} ${formatPrice(status.zeroFee)})`}</dd></div>
          <div><dt>{t('Чтобы заработать', 'To earn')} {formatPrice(position.plus)}, {t('выставить за', 'list at')}</dt><dd className="mono">{status.ask === null ? t('нет такой цены', 'no such price') : `${formatPrice(status.ask)} (${t('комиссия', 'fee')} ${formatPrice(status.askFee)})`}</dd></div>
          <div><dt>{t('Самая низкая цена сейчас', 'Lowest price now')}</dt><dd className="mono">{current ? formatPrice(current) : t('нет лотов', 'no offers')}</dd></div>
          {status.nowAsk !== undefined && <div><dt>{t('Если выставить сейчас', 'If listed now')}: {formatPrice(status.nowAsk)}, {t('комиссия', 'fee')} {formatPrice(status.nowFee ?? 0)}</dt><dd className={`mono ${(status.nowPlus ?? 0) >= 0 ? 'price-up' : 'price-down'}`}>{money(status.nowPlus ?? 0)}</dd></div>}
          {trader && <div><dt>{t('Или торговцу', 'Or to a trader')}: {uiText(trader.source)} {formatPrice(trader.price)}</dt><dd className={`mono ${trader.price - position.paid >= 0 ? 'price-up' : 'price-down'}`}>{money(trader.price - position.paid)}</dd></div>}
          {week && <div><dt>{t('За неделю: минимум / максимум', 'Week: low / high')}</dt><dd className="mono">{formatPrice(week.min)} / {formatPrice(week.max)}</dd></div>}
        </dl>
        {history && history.series.length >= 2 && target && <ForecastText history={history} target={target} current={current} now={now} locale={locale} />}
        <p className="trading-note">{t('Это оценка: лот может не продаться, комиссия при этом не вернётся.', 'An estimate: a listing may not sell, and the fee is then not returned.')}</p>
        <button type="button" className="button ghost" onClick={() => removePosition(position.mode, position.itemId)}>{t('Продал', 'Sold it')}</button>
      </section>
    </div>
  </div>
}

interface PurchaseEntry { position: TradingPosition; item?: Item; current?: number; offer?: ReturnType<typeof traderOffer>; status: PositionStatus; toTrader: boolean; sellNow?: number; renewedAt?: number; known?: { history: History; week?: TradingModule['w7'] }; peak: ReturnType<typeof peakForecast> }
type PurchaseSortKey = 'fresh' | 'name' | 'paid' | 'zero' | 'ask' | 'now' | 'sellNow' | 'peak'

const PURCHASE_VALUE: Record<Exclude<PurchaseSortKey, 'fresh'>, (entry: PurchaseEntry) => number | string | undefined> = {
  name: (entry) => uiText(entry.item?.name ?? entry.position.itemId),
  paid: (entry) => entry.position.paid,
  zero: (entry) => entry.status.zeroAsk ?? undefined,
  ask: (entry) => entry.status.ask ?? undefined,
  now: (entry) => entry.current,
  sellNow: (entry) => entry.sellNow === undefined ? undefined : -entry.sellNow,
  peak: (entry) => entry.peak?.hours,
}

/** «Куплено»: what the player bought in this mode, what it takes to break even and to earn the chosen sum, what it brings now. Never hidden, however old its price. */
function BoughtView({ positions, items, mode, fee, histories, selected, onOpen, period, now, clock, locale }: {
  positions: TradingPosition[]
  items: ReadonlyMap<string, Item>
  mode: RaidMode
  fee: Fee
  histories: ReadonlyMap<string, { history: History; week?: TradingModule['w7'] }>
  selected: string | null
  onOpen: (id: string) => void
  period: TradingPeriod
  now: number
  clock: number
  locale: Locale
}) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const stamp = useStamp(locale)
  const [sort, onSort] = useColumnSort<PurchaseSortKey>('fresh')
  const entries = useMemo(() => positions.map((position): PurchaseEntry => {
    const item = items.get(position.itemId)
    const current = item ? currentPrice(item, mode) : undefined
    const offer = item ? traderOffer(item, mode) : undefined
    const status = positionStatus(position, current, offer?.price ?? 0, fee)
    // Whichever brings more now: a listing after the fee, or the trader at once.
    const traderPlus = offer ? offer.price - position.paid : undefined
    const toTrader = traderPlus !== undefined && (status.nowPlus === undefined || traderPlus > status.nowPlus)
    const sellNow = toTrader ? traderPlus : status.nowPlus
    const renewedAt = current !== undefined ? fleaRenewedAt(item, mode) : undefined
    const known = histories.get(position.itemId)
    const peak = known ? peakForecast(rowScans(known.history), now) : null
    return { position, status, toTrader, peak, ...(item ? { item } : {}), ...(current !== undefined ? { current } : {}), ...(offer ? { offer } : {}), ...(sellNow !== undefined ? { sellNow } : {}), ...(renewedAt !== undefined ? { renewedAt } : {}), ...(known ? { known } : {}) }
  }), [fee, histories, items, mode, now, positions])
  const sorted = useMemo(() => sort.key === 'fresh' ? freshestFirst(entries, (entry) => entry.renewedAt, (entry) => entry.sellNow ?? 0, sort.dir) : sortByValue(entries, PURCHASE_VALUE[sort.key], sort.dir), [entries, sort])
  const steady = useSteadyOrder(sorted, purchaseId, selected ? `${sort.key}:${sort.dir}` : null)
  if (!positions.length) return <p className="muted trading-empty trading-bought-empty">{t('Пока ничего не куплено. Нажмите правой кнопкой мыши на предмет в списке и выберите «Купил», или откройте предмет и нажмите «Купил».', 'Nothing bought yet. Right-click an item in the list and choose «Bought it», or open an item and press «Bought it».')}</p>
  return <div className="economy-table-wrap">
    <table className="price-table economy-table trading-table trading-bought">
      <thead><tr>
        <SortHead id="name" text sort={sort} onSort={onSort} label={t('Предмет', 'Item')} />
        <SortHead id="paid" sort={sort} onSort={onSort} label={t('Куплено за', 'Paid')} />
        <SortHead id="zero" sort={sort} onSort={onSort} label={t('В ноль', 'Break even')} title={t('Цена, при которой после комиссии вернётся всё, что вы заплатили', 'The price at which, after the fee, you get back what you paid')} />
        <SortHead id="ask" sort={sort} onSort={onSort} label={t('Под ваш плюс', 'For your plus')} />
        <SortHead id="now" sort={sort} onSort={onSort} label={t('Сейчас', 'Now')} />
        <FreshHead sort={sort} onSort={onSort} locale={locale} />
        <SortHead id="sellNow" highFirst sort={sort} onSort={onSort} label={t('Если продать сейчас', 'If sold now')} />
        <SortHead id="peak" sort={sort} onSort={onSort} label={t('Через сколько продать', 'When to sell')} title={t('Когда по прогнозу цена будет самой высокой в ближайшие двое суток, по вашему времени. Прогноз по прошлой неделе, не гарантия.', 'When the forecast has the price at its highest in the next two days, your time. A forecast from the past week, not a guarantee.')} />
      </tr></thead>
      <tbody>
        {steady.map(({ position, item, current, offer, status, toTrader, sellNow, renewedAt, known, peak }) => {
          const open = selected === position.itemId
          return [
            <tr key={position.itemId} className={`trading-row ${open ? 'open' : ''} ${status.ready ? 'has-sell' : ''}`} onClick={() => onOpen(position.itemId)}>
              <td>
                <div className="trading-item">
                  {item && <img src={item.iconUrl} alt="" loading="lazy" className="economy-thumb" />}
                  <span className="economy-line-text">
                    <button type="button" className="trading-name" aria-expanded={open} onClick={(event) => { event.stopPropagation(); onOpen(position.itemId) }}>{item ? uiText(item.name) : position.itemId} {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
                    {status.ready && <small className="price-up">{t('можно продавать', 'can sell')}</small>}
                  </span>
                </div>
              </td>
              <td className="num mono">{formatPrice(position.paid)}</td>
              <td className="num mono">{status.zeroAsk === null ? '—' : formatPrice(status.zeroAsk)}</td>
              <td className="num mono">{status.ask === null ? '—' : formatPrice(status.ask)}<small className="dim trading-sub">{money(position.plus)}</small></td>
              <td {...priceCell(renewedAt, clock, locale)}>{current ? formatPrice(current) : <span className="dim">{t('нет лотов', 'no offers')}</span>}</td>
              <PriceAge at={renewedAt} clock={clock} locale={locale} />
              <td className="num mono">
                <span className={(sellNow ?? 0) >= 0 ? 'price-up' : 'price-down'}>{sellNow === undefined ? '—' : money(sellNow)}</span>
                {toTrader && <small className="dim"> {t('торговцу', 'to a trader')}</small>}
                <button type="button" className="icon-button trading-bell" aria-pressed={position.notify} title={position.notify ? t('Уведомление включено', 'Notification on') : t('Уведомление выключено', 'Notification off')} aria-label={position.notify ? t('Выключить уведомление', 'Turn the notification off') : t('Включить уведомление', 'Turn the notification on')} onClick={(event) => { event.stopPropagation(); savePosition({ ...position, notify: !position.notify }) }}>{position.notify ? <Bell size={13} /> : <BellOff size={13} />}</button>
              </td>
              <td className="num trading-peak-cell">
                {peak ? <><span>{inHours(peak.hours, locale)}</span><small className="dim mono trading-sub">{stamp.format(peak.at)}</small></> : <span className="dim">{known ? t('нет пика', 'no peak') : '—'}</span>}
              </td>
            </tr>,
            open && <tr key={`${position.itemId}-detail`} className="trading-detail-row"><td colSpan={8}><PurchaseDetail position={position} status={status} {...(item ? { item } : {})} {...(known ? { history: known.history } : {})} {...(known?.week ? { week: known.week } : {})} {...(offer ? { trader: { source: offer.source, price: offer.price } } : {})} fee={fee} period={period} now={now} locale={locale} /></td></tr>,
          ]
        })}
      </tbody>
    </table>
  </div>
}

interface ModuleEntry { module: TradingModule; item: Item; current: number; deal: ModuleDeal; traderName: string; questNames: string[]; renewedAt?: number }

function ModuleDetail({ entry, position, period, fee, mode, now, onBought, locale }: { entry: ModuleEntry; position?: TradingPosition; period: TradingPeriod; fee: Fee; mode: RaidMode; now: number; onBought: () => void; locale: Locale }) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const { ref, width } = useVisibleWidth()
  const [target, setTarget] = useState<number | undefined>(undefined)
  const { module, deal, item, current, traderName, questNames } = entry
  const sells = traderOffer(item, mode)
  const highOf = period === 3 && module.w3 ? module.w3 : module.w7
  return <div className="trading-detail" ref={ref} style={{ width }}>
    {module.series.length >= 2 && <TradingChart row={module} period={period} current={current} target={target} now={now} width={width - 28} locale={locale} />}
    <div className="trading-detail-grid">
      <SaleCalculator source={{ id: module.id, base: module.base, defaultPaid: deal.offer.price, ...(sells ? { traderName: sells.source } : {}), traderPrice: sells?.price ?? 0, ...(highOf ? { limit: { high: Math.max(highOf.max, current), period: highOf === module.w3 ? 3 as const : 7 as const } } : {}) }} position={position} fee={fee} mode={mode} target={target} setTarget={setTarget} onBought={onBought} locale={locale} />
      <section className="trading-forecast">
        {module.series.length >= 2 && <ForecastText history={module} target={target ?? deal.ask} current={current} now={now} locale={locale} />}
        <dl>
          <div><dt>{t('Купить у торговца', 'Buy from the trader')}: {uiText(traderName)}, {t('уровень', 'level')} {deal.offer.level}</dt><dd className="mono">{formatPrice(deal.offer.price)}</dd></div>
          {deal.offer.limit && <div><dt>{t('Лимит за поставку', 'Limit per restock')}</dt><dd>{deal.offer.limit}</dd></div>}
          <div><dt>{t('Выставить на барахолку', 'List on the flea market')}, {t('комиссия', 'fee')} {formatPrice(deal.fee)}</dt><dd className="mono">{formatPrice(deal.ask)}</dd></div>
          <div><dt>{t('Останется после комиссии', 'Left after the fee')}</dt><dd className="mono">{formatPrice(deal.net)}</dd></div>
          <div><dt>{t('Выгода с одного', 'Profit per item')}</dt><dd className="mono price-up">{money(deal.profit)}</dd></div>
          {module.w7 && <div><dt>{t('За неделю: минимум / максимум', 'Week: low / high')}</dt><dd className="mono">{formatPrice(module.w7.min)} / {formatPrice(module.w7.max)}</dd></div>}
          {module.w7 && <div><dt>{t('Предложений на рынке обычно', 'Usual offers on the market')}</dt><dd>{module.w7.offers}</dd></div>}
        </dl>
        {questNames.length > 0 && <p className="trading-note">{t('Нужен для', 'Needed for')}: {questNames.map((name) => uiText(name)).join(', ')}</p>}
        {module.w7 && module.w7.offers < 5 && <p className="trading-note warn"><AlertTriangle size={13} /> {t('Мало предложений: цена может держаться на одном лоте, а покупателя можно ждать долго.', 'Few offers: the price may rest on one listing, and a buyer may take long to come.')}</p>}
      </section>
    </div>
  </div>
}

interface BuyTarget { id: string; base: number; name: string; icon?: string; price: number }
type ModuleSortKey = 'fresh' | 'name' | 'trader' | 'buy' | 'flea' | 'fee' | 'profit'

const MODULE_VALUE: Record<Exclude<ModuleSortKey, 'fresh'>, (entry: ModuleEntry) => number | string> = {
  name: (entry) => uiText(entry.item.name),
  trader: (entry) => uiText(entry.traderName),
  buy: (entry) => entry.deal.offer.price,
  flea: (entry) => entry.current,
  fee: (entry) => entry.deal.fee,
  profit: (entry) => -entry.deal.profit,
}

/**
 * «Продажа модулей» (owner, 05.11.2026): what the Gunsmith builds name by themselves and a trader sells for less than the market
 * leaves after the fee. Only what is open to this player: the trader's level, the quest that opens the offer, the market's level.
 */
function ModulesView({ modules, items, mode, fee, level, positions, selected, onOpen, onContext, onBought, period, now, clock, locale }: {
  modules: readonly TradingModule[]
  items: ReadonlyMap<string, Item>
  mode: RaidMode
  fee: Fee
  level?: number
  positions: TradingPosition[]
  selected: string | null
  onOpen: (id: string) => void
  onContext: (event: React.MouseEvent, target: BuyTarget) => void
  onBought: (id: string) => void
  period: TradingPeriod
  now: number
  clock: number
  locale: Locale
}) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const [sort, onSort] = useColumnSort<ModuleSortKey>('fresh')
  const { data } = useTarkovData()
  const state = useAppState()
  const progress = state.activeProfile.modes[mode]
  const availability = useMemo(() => questAvailabilityOf(data.quests, progress), [data.quests, progress])
  const statusOf = useCallback((questId: string) => availability.get(questId)?.status, [availability])
  const { infos } = useTraderLevels(mode, data.traders, data.quests, statusOf, progress.playerLevel, progress.logCharacterId)
  const entries = useMemo(() => {
    const isOpen = (offer: TraderOffer) => {
      if (level === undefined) return true
      const info = infos.find((entry) => entry.trader.id === offer.traderId)
      if (info && offer.level > info.max) return false
      return !offer.questId || statusOf(offer.questId) === 'completed'
    }
    return modules.flatMap((module): ModuleEntry[] => {
      const item = items.get(module.id)
      if (!item || (level !== undefined && !openAtLevel(module.level, level))) return []
      const current = currentPrice(item, mode)
      const deal = moduleDeal(module, current, fee, isOpen)
      if (!deal || current === undefined) return []
      const trader = data.traders.find((entry) => entry.id === deal.offer.traderId)
      const questNames = module.questIds.flatMap((id) => data.quests.find((quest) => quest.id === id)?.name ?? [])
      const renewedAt = fleaRenewedAt(item, mode)
      if (priceTooOld(renewedAt, clock)) return []
      return [{ module, item, current, deal, traderName: trader?.name ?? deal.offer.traderId, questNames, ...(renewedAt !== undefined ? { renewedAt } : {}) }]
    })
  }, [clock, data.quests, data.traders, fee, infos, items, level, mode, modules, statusOf])
  const sorted = useMemo(() => sort.key === 'fresh' ? freshestFirst(entries, (entry) => entry.renewedAt, (entry) => entry.deal.profit, sort.dir) : sortByValue(entries, MODULE_VALUE[sort.key], sort.dir), [entries, sort])
  const steady = useSteadyOrder(sorted, moduleEntryId, selected ? `${sort.key}:${sort.dir}` : null)
  if (!modules.length) return <p className="muted trading-empty trading-bought-empty">{t('Список модулей появится со следующим обновлением статистики на сервере.', 'The list of modules will come with the next statistics update on the server.')}</p>
  return <>
    <p className="trading-summary dim">{t('Модули, которые требуются для квестов «Оружейник».', 'Modules required for the Gunsmith quests.')}</p>
    {entries.length === 0
      ? <p className="muted trading-empty trading-bought-empty">{t('Сейчас выгодных модулей на вашем уровне нет.', 'No profitable modules at your level right now.')}</p>
      : <div className="economy-table-wrap">
          <table className="price-table economy-table trading-table trading-modules">
            <thead><tr>
              <SortHead id="name" text sort={sort} onSort={onSort} label={t('Модуль', 'Module')} />
              <SortHead id="trader" text sort={sort} onSort={onSort} label={t('Торговец', 'Trader')} />
              <SortHead id="buy" sort={sort} onSort={onSort} label={t('Купить', 'Buy')} />
              <SortHead id="flea" sort={sort} onSort={onSort} label={t('На барахолке', 'Flea market')} />
              <FreshHead sort={sort} onSort={onSort} locale={locale} />
              <SortHead id="fee" sort={sort} onSort={onSort} label={t('Комиссия', 'Fee')} />
              <SortHead id="profit" highFirst sort={sort} onSort={onSort} label={t('Выгода', 'Profit')} />
            </tr></thead>
            <tbody>
              {steady.map((entry) => {
                const open = selected === entry.module.id
                const position = positions.find((row) => row.itemId === entry.module.id)
                return [
                  <tr key={entry.module.id} className={`trading-row ${open ? 'open' : ''}`} onClick={() => onOpen(entry.module.id)} onContextMenu={(event) => onContext(event, { id: entry.module.id, base: entry.module.base, name: entry.item.name, ...(entry.item.iconUrl ? { icon: entry.item.iconUrl } : {}), price: entry.deal.offer.price })}>
                    <td>
                      <div className="trading-item">
                        <img src={entry.item.iconUrl} alt="" loading="lazy" className="economy-thumb" />
                        <span className="economy-line-text">
                          <button type="button" className="trading-name" aria-expanded={open} onClick={(event) => { event.stopPropagation(); onOpen(entry.module.id) }}>{uiText(entry.item.name)} {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
                          {entry.questNames.length > 0 && <small className="dim">{t('Для', 'For')}: {entry.questNames.map((name) => uiText(name)).join(', ')}</small>}
                          {position && <small className="dim">{t('куплено', 'bought')}</small>}
                        </span>
                      </div>
                    </td>
                    <td>{uiText(entry.traderName)} <small className="dim">{t('ур.', 'lvl')} {entry.deal.offer.level}</small></td>
                    <td className="num mono">{formatPrice(entry.deal.offer.price)}</td>
                    <td {...priceCell(entry.renewedAt, clock, locale)}>{formatPrice(entry.current)}</td>
                    <PriceAge at={entry.renewedAt} clock={clock} locale={locale} />
                    <td className="num mono price-down">−{formatPrice(entry.deal.fee)}</td>
                    <td className="num mono price-up">{money(entry.deal.profit)}</td>
                  </tr>,
                  open && <tr key={`${entry.module.id}-detail`} className="trading-detail-row"><td colSpan={7}><ModuleDetail entry={entry} {...(position ? { position } : {})} period={period} fee={fee} mode={mode} now={now} onBought={() => onBought(entry.module.id)} locale={locale} /></td></tr>,
                ]
              })}
            </tbody>
          </table>
        </div>}
  </>
}

/**
 * «Продажа торговцам» (owner, 05.11.2026; a player's proposal: «от большей к меньшей выгоде»): cheaper on the market than a trader
 * pays, at this minute's prices. Nothing about what the item will do later, so no chart: right click marks it as bought.
 */
function TraderSalesView({ sales, listed, positions, onContext, clock, locale }: { sales: readonly TraderSale[]; listed: boolean; positions: TradingPosition[]; onContext: (event: React.MouseEvent, target: BuyTarget) => void; clock: number; locale: Locale }) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const [all, setAll] = useState(false)
  const [sort, onSort] = useColumnSort<SaleSortKey>('fresh')
  const sorted = useMemo(() => sortSales(sales, sort), [sales, sort])
  if (!listed) return <p className="muted trading-empty trading-bought-empty">{t('Список появится со следующим обновлением статистики на сервере.', 'The list will come with the next statistics update on the server.')}</p>
  return <>
    <p className="trading-summary dim">{t('На барахолке дешевле, чем платит торговец. Без предметов с прочностью и ресурсом. Цена могла измениться: проверьте перед покупкой.', 'Cheaper on the flea market than a trader pays. No items with durability or a resource. The price may have changed: check before buying.')}</p>
    {sales.length === 0
      ? <p className="muted trading-empty trading-bought-empty">{t('Сейчас таких предметов нет.', 'No such items right now.')}</p>
      : <>
        <div className="economy-table-wrap">
          <table className="price-table economy-table trading-table trading-trader-sales">
            <thead><tr>
              <SortHead id="name" text sort={sort} onSort={onSort} label={t('Предмет', 'Item')} />
              <SortHead id="price" sort={sort} onSort={onSort} label={t('На барахолке', 'Flea market')} />
              <FreshHead sort={sort} onSort={onSort} locale={locale} />
              <SortHead id="trader" text sort={sort} onSort={onSort} label={t('Торговец', 'Trader')} />
              <SortHead id="pays" highFirst sort={sort} onSort={onSort} label={t('Платит', 'Pays')} />
              <SortHead id="profit" highFirst sort={sort} onSort={onSort} label={t('Выгода', 'Profit')} />
            </tr></thead>
            <tbody>
              {(all ? sorted : sorted.slice(0, ROWS_SHOWN)).map((sale) => <tr key={sale.item.id} className="trading-sale-row" onContextMenu={(event) => { if (sale.item.basePrice) onContext(event, { id: sale.item.id, base: sale.item.basePrice, name: sale.item.name, ...(sale.item.iconUrl ? { icon: sale.item.iconUrl } : {}), price: sale.price }) }}>
                <td>
                  <div className="trading-item">
                    <img src={sale.item.iconUrl} alt="" loading="lazy" className="economy-thumb" />
                    <span className="economy-line-text">
                      <strong className="trading-sale-name">{uiText(sale.item.name)}</strong>
                      <small className="dim trading-sale-trader">{uiText(sale.traderName)}</small>
                      {positions.some((position) => position.itemId === sale.item.id) && <small className="dim">{t('куплено', 'bought')}</small>}
                    </span>
                  </div>
                </td>
                <td {...priceCell(sale.renewedAt, clock, locale)}>{formatPrice(sale.price)}</td>
                <PriceAge at={sale.renewedAt} clock={clock} locale={locale} />
                <td>{uiText(sale.traderName)}</td>
                <td className="num mono">{formatPrice(sale.traderPrice)}</td>
                <td className="num mono price-up">{money(sale.profit)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {sales.length > ROWS_SHOWN && <button type="button" className="button ghost trading-more" onClick={() => setAll((value) => !value)}>{all ? t('Свернуть', 'Show fewer') : t(`Показать все: ${sales.length}`, `Show all: ${sales.length}`)}</button>}
      </>}
  </>
}

/** `text`: a column of words, to the left. `highFirst`: its first click puts the biggest on top. */
function SortHead<K extends string>({ id, label, title, sort, onSort, text, highFirst, extraClass = '' }: { id: K; label: string; title?: string; sort: TableSort<K>; onSort: (key: K) => void; text?: boolean; highFirst?: boolean; extraClass?: string }) {
  const active = sort.key === id
  const ascending = (sort.dir === 1) !== Boolean(highFirst)
  return <th className={`${text ? '' : 'num'} ${extraClass}`.trim()} aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'} {...(title ? { title } : {})}>
    <button type="button" className={`trading-sort ${active ? 'active' : ''}`} onClick={() => onSort(id)}>{label}{active && (sort.dir === 1 ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}</button>
  </th>
}

function FreshHead<K extends string>({ sort, onSort, locale }: { sort: TableSort<K>; onSort: (key: K) => void; locale: Locale }) {
  return <SortHead id={'fresh' as K} highFirst extraClass="trading-age-head" sort={sort} onSort={onSort} label={locale === 'en' ? 'Freshness' : 'Актуальность'} title={locale === 'en' ? 'How long ago the price was updated. The freshest are on top.' : 'Как давно обновилась цена. Самые свежие сверху.'} />
}

function RowView({ entry, expanded, bought, onToggle, onContext, children, clock, locale }: { entry: BoardRow; expanded: boolean; bought: boolean; onToggle: () => void; onContext: (event: React.MouseEvent) => void; children: React.ReactNode; clock: number; locale: Locale }) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const { window, signal } = entry
  return <>
    <tr className={`trading-row ${expanded ? 'open' : ''} ${signal ? `has-${signal.kind}` : ''}`} onClick={onToggle} onContextMenu={onContext}>
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
      <td {...priceCell(entry.renewedAt, clock, locale)}>{entry.current !== undefined ? <span className={signal?.kind === 'buy' ? 'price-up' : signal?.kind === 'sell' ? 'price-down' : ''}>{formatPrice(entry.current)}</span> : <span className="dim">{t('нет лотов', 'no offers')}</span>}</td>
      <PriceAge at={entry.renewedAt} clock={clock} locale={locale} />
      <td className="num mono">{formatPrice(window.max)}</td>
      <td className="num"><SalesChip entry={entry} locale={locale} /></td>
    </tr>
    {expanded && <tr className="trading-detail-row"><td colSpan={6}>{children}</td></tr>}
  </>
}

/** Right click: the one thing it offers. */
function BuyMenu({ x, y, onBuy, onClose, locale }: { x: number; y: number; onBuy: () => void; onClose: () => void; locale: Locale }) {
  useEffect(() => {
    const close = () => onClose()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', onKey) }
  }, [onClose])
  return <div className="trading-menu" role="menu" style={{ left: x, top: y }}>
    <button type="button" role="menuitem" onClick={(event) => { event.stopPropagation(); onBuy() }}><Check size={13} /> {locale === 'en' ? 'Bought it' : 'Купил'}</button>
  </div>
}

/** «вылазит окно, за сколько, вводишь цену»: the price, and it goes to «Куплено». */
function BuyDialog({ target, onBuy, onClose, locale }: { target: BuyTarget; onBuy: (paid: number) => void; onClose: () => void; locale: Locale }) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const [text, setText] = useState(String(target.price))
  const paid = digits(text)
  return <div className="registration-overlay trading-dialog-overlay" role="dialog" aria-modal="true" aria-label={t('За сколько купили', 'What you paid')} onClick={onClose} onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
    <form className="panel trading-dialog" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (paid > 0) onBuy(paid) }}>
      <div className="trading-dialog-head">
        {target.icon && <img src={target.icon} alt="" className="economy-thumb" />}
        <strong>{uiText(target.name)}</strong>
      </div>
      <label className="trading-field">
        <span>{t('За сколько купили', 'What you paid')}</span>
        <input autoFocus className="input mono" inputMode="numeric" value={text} aria-label={t('За сколько купили', 'What you paid')} onChange={(event) => setText(cleanDigits(event.target.value))} onFocus={(event) => event.target.select()} />
      </label>
      <div className="trading-buy">
        <button type="submit" className="button primary" disabled={paid <= 0}><Check size={14} /> {t('Купил', 'Bought it')}</button>
        <button type="button" className="button ghost" onClick={onClose}>{t('Отмена', 'Cancel')}</button>
      </div>
    </form>
  </div>
}

/**
 * «Торговля» in «Экономика» (owner, 05.11.2026), its own block and not the flea market's page. The items that swing hardest,
 * for 3 days or a week, the freshest prices on top (freshestFirst): the lowest price, the price now, its age, the highest, the
 * successful sales; a click on a heading sorts by it. A click on an item opens the chart with dates, hours and a forecast and the sums; a right click offers
 * «Купил» with a window for the price. «Куплено» follows what was bought, with its messages. «Продажа модулей» is what the
 * Gunsmith needs and a trader sells for less than the market. All of it an estimate from history (src/domain/trading.ts).
 * We ask for prices every minute while this page is open, though an item is renewed only every 10 to 100 minutes (docs/trading.md); the server hands out a prepared file, so 30–60 players cost it next to nothing.
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
  const view: View = params.get('view') === 'bought' ? 'bought' : params.get('view') === 'modules' ? 'modules' : params.get('view') === 'traders' ? 'traders' : 'list'
  const [period, setPeriod] = useState<TradingPeriod>(7)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | TradingKind>('all')
  const [sort, onSort] = useColumnSort<TradingSortKey>('fresh')
  const [allBuys, setAllBuys] = useState(false)
  const [allSells, setAllSells] = useState(false)
  const [allRows, setAllRows] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; target: BuyTarget } | null>(null)
  const [buying, setBuying] = useState<BuyTarget | null>(null)
  const selected = params.get('item')
  const snapshot = stats.data ?? null
  const modules = useMemo(() => snapshot?.modules ?? [], [snapshot])
  // The statistics' items and the player's purchases, at this minute's prices.
  const items = useMemo(() => {
    const wanted = new Set([...(snapshot?.rows.map((row: TradingRow) => row.id) ?? []), ...modules.map((module) => module.id), ...(snapshot?.traderItems?.map((entry) => entry.id) ?? []), ...positions.map((position) => position.itemId)])
    return new Map(data.items.filter((item) => wanted.has(item.id)).map((item) => [item.id, withLivePrice(item, mode, live)]))
  }, [data.items, live, mode, modules, positions, snapshot])
  const histories = useMemo(() => {
    const known = new Map<string, { history: History; week?: TradingModule['w7'] }>()
    for (const module of modules) known.set(module.id, { history: module, ...(module.w7 ? { week: module.w7 } : {}) })
    for (const row of snapshot?.rows ?? []) known.set(row.id, { history: row, week: row.w7 })
    return known
  }, [modules, snapshot])
  const level = knownLevel(progress)
  const fee = useMemo(() => feeOptionsFor(snapshot ?? { fee: { offerFeeRate: 0.05, requirementFeeRate: 0.05 } }, data.hideout, progress.hideoutLevels), [data.hideout, progress.hideoutLevels, snapshot])
  // Demo prices or a catalog that has not come yet: zeros here would read as «nothing to trade».
  const pricesReady = source !== 'demo' && (!snapshot?.rows.length || items.size > 0)
  // A price's age is held against the server's time, renewed with each file: a wrong clock on this computer must not empty the page.
  const priceClock = live?.updatedAt ?? now
  const rows = useMemo(() => snapshot && pricesReady ? boardRows({ snapshot, items, mode, period, fee, playerLevel: level, now, priceClock }) : [], [fee, items, level, mode, now, period, priceClock, pricesReady, snapshot])
  const sales = useMemo(() => snapshot?.traderItems && pricesReady ? traderSales({ candidates: snapshot.traderItems, items, mode, clock: priceClock, ...(level !== undefined ? { playerLevel: level } : {}) }) : [], [items, level, mode, priceClock, pricesReady, snapshot])
  const open = (id: string) => setParams((current) => {
    const next = new URLSearchParams(current)
    if (next.get('item') === id) next.delete('item')
    else next.set('item', id)
    return next
  }, { replace: true })
  const setView = (next: View, item?: string) => setParams((current) => {
    const nextParams = new URLSearchParams(current)
    if (next === 'list') nextParams.delete('view')
    else nextParams.set('view', next)
    if (item) nextParams.set('item', item)
    else nextParams.delete('item')
    return nextParams
  }, { replace: true })
  const onContext = (event: React.MouseEvent, target: BuyTarget) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, target })
  }
  const buyTarget = (entry: BoardRow): BuyTarget => ({ id: entry.row.id, base: entry.row.base, name: entry.item.name, ...(entry.item.iconUrl ? { icon: entry.item.iconUrl } : {}), price: entry.current ?? entry.row.buyBelow })
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort])
  const ordered = useSteadyOrder(sorted, boardRowId, selected ? `${sort.key}:${sort.dir}:${period}` : null)
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase()
    return ordered
      .filter((row) => kind === 'all' || row.row.kind === kind)
      .filter((row) => !words || `${row.item.name} ${row.item.shortName} ${uiText(row.item.name)} ${uiText(row.item.shortName)}`.toLowerCase().includes(words))
  }, [kind, ordered, query])
  // A signal or a message opens its item wherever it stands: past the first rows, or filtered out by the search.
  const opened = useMemo(() => rows.find((row) => row.row.id === selected), [rows, selected])
  const visible = useMemo(() => {
    const list = allRows ? shown : shown.slice(0, ROWS_SHOWN)
    return opened && !list.includes(opened) ? [opened, ...list] : list
  }, [allRows, opened, shown])
  useEffect(() => {
    if (selected) document.querySelector('.trading-row.open')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [selected, view])
  const buys = useMemo(() => signalsFirst(shown.filter((row) => row.signal?.kind === 'buy')), [shown])
  const sells = useMemo(() => signalsFirst(shown.filter((row) => row.signal?.kind === 'sell')), [shown])
  const modeName = mode === 'seasonal' ? t('Сезон', 'Season') : mode.toUpperCase()
  const stale = snapshot ? tradingStale(snapshot, now) : false
  const hoursAgo = snapshot ? Math.max(0, Math.round((now - Date.parse(snapshot.builtAt)) / 3_600_000)) : 0
  // When tarkov.dev last renewed a price, on the player's clock; we ask every minute while this page is open (useLivePrices), so it shows at once.
  const lastPrices = live?.pricesAt ? new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', { hour: '2-digit', minute: '2-digit' }).format(live.pricesAt) : null

  return <div className="page trading-page">
    <header className="page-header">
      <div>
        <div className="eyebrow">{t('Экономика · ', 'Economy · ')}{modeName}</div>
        <h1 className="page-title">{t('Торговля', 'Trading')}</h1>
        <p className="page-subtitle">{t('Купить дешевле, продать дороже.', 'Buy low, sell high.')}</p>
        <p className="trading-disclaimer">{t('Это не гарантия заработка, а просто статистика. Из-за скачков цен на барахолке цена может отличаться.', 'This is no guarantee of earnings, only statistics. Because of price jumps on the flea market the price may differ.')}</p>
        <p className="trading-disclaimer">{t('Цены обновляются часто.', 'Prices update often.')}</p>
      </div>
      <div className="trading-freshness">
        <span className="tag green">{lastPrices ? t(`последнее обновление цен: ${lastPrices}`, `prices last updated: ${lastPrices}`) : t('цены из каталога', 'prices from the catalog')}</span>
        {snapshot && <span className={`tag ${stale ? 'danger' : 'green'}`}>{hoursAgo ? t(`статистика: ${hoursAgo} ч назад`, `statistics: ${hoursAgo} h ago`) : t('статистика свежая', 'statistics are fresh')}</span>}
      </div>
    </header>

    <HowTo locale={locale} chart={view !== 'traders'} />

    {stats.isLoading && <div className="panel economy-loading" aria-busy="true">{t('Загружаю статистику…', 'Loading the statistics…')}</div>}
    {!stats.isLoading && !snapshot && <div className="panel import-warning"><AlertTriangle size={17} />{stats.isError
      ? t('Не удалось получить статистику. Следующая попытка через 15 минут.', 'Could not get the statistics. The next try is in 15 minutes.')
      : t('Статистика по этому режиму ещё собирается. Сервер считает её несколько раз в день, в первый раз это занимает около часа.', 'The statistics for this mode are still being gathered. The server builds them a few times a day; the first time takes about an hour.')}</div>}
    {stale && <div className="panel import-warning"><AlertTriangle size={17} />{t('Статистика устарела: сигналы выключены, пока сервер её не обновит.', 'The statistics are out of date: signals are off until the server renews them.')}</div>}

    {snapshot && level !== undefined && level < MARKET_LEVEL && <div className="panel import-warning"><AlertTriangle size={17} />{t(`Барахолка откроется на ${MARKET_LEVEL} уровне, сейчас у вас ${level}. Здесь показывается только то, что можно купить и продать на вашем уровне.`, `The flea market opens at level ${MARKET_LEVEL}, you are level ${level}. Only what you can buy and sell at your level is shown here.`)}</div>}
    {snapshot && level === undefined && <div className="panel import-warning"><AlertTriangle size={17} />{t('Уровень персонажа в этом режиме ещё не определён, поэтому показаны все предметы и уведомления о сигналах выключены. Часть предметов может быть закрыта на барахолке.', 'Your level in this mode is not known yet, so all items are shown and signal notifications are off. Some items may be closed to you on the flea market.')}</div>}

    {snapshot && !pricesReady && <div className="panel economy-loading" aria-busy="true">{t('Жду актуальные цены…', 'Waiting for current prices…')}</div>}

    {snapshot && pricesReady && <>
      <section className="panel trading-top">
        <div className="panel-header economy-toolbar trading-toolbar">
          <div className="mode-switch" role="group" aria-label={t('Период', 'Period')}>
            <button type="button" className={view === 'list' && period === 3 ? 'active' : ''} onClick={() => { setPeriod(3); if (view !== 'list') setView('list') }}>{t('Цена за 3 дн.', 'Price for 3 days')}</button>
            <button type="button" className={view === 'list' && period === 7 ? 'active' : ''} onClick={() => { setPeriod(7); if (view !== 'list') setView('list') }}>{t('Цена за неделю', 'Price for a week')}</button>
          </div>
          <div className="mode-switch trading-views" role="group" aria-label={t('Раздел', 'Section')}>
            <button type="button" className={view === 'bought' ? 'active' : ''} onClick={() => setView('bought')}>{t('Куплено', 'Bought')}{positions.length ? ` (${positions.length})` : ''}</button>
            <button type="button" className={view === 'modules' ? 'active' : ''} onClick={() => setView('modules')}>{t('Продажа модулей', 'Selling modules')}</button>
            <button type="button" className={`trading-view-traders ${view === 'traders' ? 'active' : ''}`} onClick={() => setView('traders')}>{t('Продажа торговцам', 'Selling to traders')}</button>
          </div>
          {view === 'list' && <div className="filter-row">
            <div className="economy-search"><Search size={14} /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Поиск предмета…', 'Search for an item…')} aria-label={t('Поиск предмета', 'Search for an item')} /></div>
            <select className="select" value={kind} aria-label={t('Вид предмета', 'Item kind')} onChange={(event) => setKind(event.target.value as typeof kind)}>{KINDS.map((entry) => <option key={entry.key} value={entry.key}>{locale === 'en' ? entry.en : entry.ru}</option>)}</select>
          </div>}
        </div>

        {view === 'bought' && <BoughtView positions={positions} items={items} mode={mode} fee={fee} histories={histories} selected={selected} onOpen={open} period={period} now={now} clock={priceClock} locale={locale} />}

        {view === 'modules' && <ModulesView modules={modules} items={items} mode={mode} fee={fee} {...(level !== undefined ? { level } : {})} positions={positions} selected={selected} onOpen={open} onContext={onContext} onBought={(id) => setView('bought', id)} period={period} now={now} clock={priceClock} locale={locale} />}

        {view === 'traders' && <TraderSalesView sales={sales} listed={Boolean(snapshot.traderItems)} positions={positions} onContext={onContext} clock={priceClock} locale={locale} />}

        {view === 'list' && <>
          <div className="economy-table-wrap">
            <table className="price-table economy-table trading-table">
              <thead><tr>
                <SortHead id="name" text sort={sort} onSort={onSort} label={t('Предмет', 'Item')} />
                <SortHead id="min" sort={sort} onSort={onSort} label={t('Минимум', 'Low')} title={t('Нажмите: сначала те, что сейчас ближе всего к своему минимуму', 'Click: first those now closest to their low')} />
                <SortHead id="now" sort={sort} onSort={onSort} label={t('Сейчас', 'Now')} title={t('Нажмите: по цене сейчас', 'Click: by the price now')} />
                <FreshHead sort={sort} onSort={onSort} locale={locale} />
                <SortHead id="max" sort={sort} onSort={onSort} label={t('Максимум', 'High')} title={t('Нажмите: сначала те, что сейчас ближе всего к своему максимуму', 'Click: first those now closest to their high')} />
                <SortHead id="sales" sort={sort} onSort={onSort} label={t('Успешные продажи', 'Successful sales')} title={t('По истории цен за месяц: сколько покупок на падении закончились в плюс. Оценка, а не реальные сделки.', 'From the past month’s price history: how many buys on a dip ended in profit. An estimate, not actual deals.')} />
              </tr></thead>
              <tbody>
                {visible.map((entry) => {
                  const position = positions.find((row) => row.itemId === entry.row.id)
                  return <RowView key={entry.row.id} entry={entry} expanded={selected === entry.row.id} bought={Boolean(position)} onToggle={() => open(entry.row.id)} onContext={(event) => onContext(event, buyTarget(entry))} clock={priceClock} locale={locale}>
                    <ItemDetail entry={entry} period={period} {...(position ? { position } : {})} fee={fee} mode={mode} now={now} onBought={() => setView('bought', entry.row.id)} locale={locale} />
                  </RowView>
                })}
                {visible.length === 0 && <tr><td colSpan={6} className="muted">{t('Под этот отбор ничего не подходит.', 'Nothing matches this filter.')}</td></tr>}
              </tbody>
            </table>
          </div>
          {shown.length > ROWS_SHOWN && <button type="button" className="button ghost trading-more" onClick={() => setAllRows((value) => !value)}>{allRows ? t('Свернуть', 'Show fewer') : t(`Показать все: ${shown.length}`, `Show all: ${shown.length}`)}</button>}
        </>}
        <p className="trading-summary dim">
          {level !== undefined ? t(`Открыто на вашем ${level} уровне: ${view === 'traders' ? sales.length : rows.length}.`, `Open at your level ${level}: ${view === 'traders' ? sales.length : rows.length}.`) : t(`Предметов: ${view === 'traders' ? sales.length : rows.length}.`, `Items: ${view === 'traders' ? sales.length : rows.length}.`)}
          {' '}{view === 'traders'
            ? t('Покупка и продажа торговцу без комиссии.', 'Buying and selling to a trader carry no fee.')
            : t(`Комиссия при продаже ${Math.round((snapshot.fee.offerFeeRate ?? 0.05) * 100)}%, покупка без комиссии.`, `Selling fee ${Math.round((snapshot.fee.offerFeeRate ?? 0.05) * 100)}%, buying has no fee.`)}
        </p>
      </section>

      {view === 'list' && <>
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
              {(allBuys ? buys : buys.slice(0, SIGNALS_SHOWN)).map((entry) => <SignalCard key={entry.row.id} entry={entry} locale={locale} onOpen={() => open(entry.row.id)} onContext={(event) => onContext(event, buyTarget(entry))} />)}
            </div>
            {buys.length > SIGNALS_SHOWN && <button type="button" className="button ghost trading-more" onClick={() => setAllBuys((value) => !value)}>{allBuys ? t('Свернуть', 'Show fewer') : t(`Показать все: ${buys.length}`, `Show all: ${buys.length}`)}</button>}
          </section>
          <section className="panel">
            <div className="panel-header"><div className="panel-title"><ArrowUpCircle size={15} className="price-down" /> {t('Цена выросла: можно продавать', 'Price is up: you can sell')}</div><span className="dim">{sells.length}</span></div>
            <div className="trading-signal-list">
              {sells.length === 0 && <p className="muted trading-empty">{t('Сейчас ничего не поднялось к максимуму.', 'Nothing is near its high right now.')}</p>}
              {(allSells ? sells : sells.slice(0, SIGNALS_SHOWN)).map((entry) => <SignalCard key={entry.row.id} entry={entry} locale={locale} onOpen={() => open(entry.row.id)} onContext={(event) => onContext(event, buyTarget(entry))} />)}
            </div>
            {sells.length > SIGNALS_SHOWN && <button type="button" className="button ghost trading-more" onClick={() => setAllSells((value) => !value)}>{allSells ? t('Свернуть', 'Show fewer') : t(`Показать все: ${sells.length}`, `Show all: ${sells.length}`)}</button>}
          </section>
        </div>
      </>}

      <section className="panel trading-howto">
        <div className="panel-header"><div className="panel-title"><Info size={14} /> {t('Как читать эти цифры', 'How to read these numbers')}</div></div>
        <ul>
          <li>{t('Сверху самые свежие цены, только что обновлённые горят зелёным. Цены старше часа не показываются.', 'The freshest prices are on top, those just updated glow green. Prices older than an hour are not shown.')}</li>
          <li>{t('Цена здесь: самая низкая на барахолке, а не средняя. По ней можно купить, и её надо перебить, чтобы продать. Проверка с одним-двумя предложениями не считается: это разовые лоты.', 'A price here is the lowest on the flea market, not the average: you can buy at it, and you have to undercut it to sell. A check with one or two offers does not count: those are lone listings.')}</li>
          <li>{t('Успешные продажи: сколько покупок на падении за прошлый месяц закончились бы в плюс, считая покупку по следующей проверке цены и продажу в течение двух суток. Это оценка по истории, данных о реальных сделках нет.', 'Successful sales: how many buys on a dip over the past month would have ended in profit, counting the purchase at the next price check and the sale within two days. An estimate from history: there is no data on actual deals.')}</li>
          <li>{t('Лот может не продаться: комиссия не вернётся, а репутация барахолки упадёт. Число своих лотов тоже ограничено репутацией.', 'A listing may not sell: the fee is not returned and flea reputation falls. Reputation also limits how many listings you can have.')}</li>
          <li>{t('Предметы, у которых копии бывают разными, здесь не рассматриваются: оружие, броня, шлемы, ключи, аптечки, лекарства на несколько применений, вода, топливо, фильтры, ремонтные наборы. Самый дешёвый такой лот часто неполный, и его цена говорит об износе, а не о рынке.', 'Items whose copies differ are not looked at here: weapons, armor, helmets, keys, medkits, medicine of several uses, water, fuel, filters, repair kits. The cheapest such listing is often not a whole one, and its price tells about wear, not the market.')}</li>
          <li>{t('Показано только то, что барахолка открывает на вашем уровне в этом режиме: и для покупки, и для продажи.', 'Only what the flea market opens at your level in this mode is shown: both to buy and to sell.')}</li>
          <li>{t('Купленное на барахолке не считается «найдено в рейде»: для квестов и убежища, где это нужно, такой предмет не подойдёт.', 'What you buy on the flea market is not «found in raid»: it will not do for quests and hideout levels that ask for it.')}</li>
        </ul>
      </section>
    </>}

    {menu && <BuyMenu x={menu.x} y={menu.y} locale={locale} onClose={() => setMenu(null)} onBuy={() => { setBuying(menu.target); setMenu(null) }} />}
    {buying && <BuyDialog target={buying} locale={locale} onClose={() => setBuying(null)} onBuy={(paid) => { savePosition({ mode, itemId: buying.id, paid, plus: 0, notify: true, base: buying.base, boughtAt: Date.now() }); setBuying(null) }} />}
  </div>
}
