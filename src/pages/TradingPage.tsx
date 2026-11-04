import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, BellRing, ChevronDown, ChevronUp, Info, Search, TrendingDown, TrendingUp } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useLivePrices, withLivePrice } from '../data/livePrices'
import { useTradingStats } from '../data/tradingApi'
import { breakEvenAsk, MARKET_LEVEL, reliabilityTier, tradingStale, type TradingKind, type TradingRow } from '../domain/trading'
import type { Item } from '../domain/types'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { formatPrice } from '../shared/format'
import { useAppState } from '../state/AppState'
import { boardRows, feeOptionsFor, knownLevel, listing, type BoardRow, type TradingPeriod } from '../trading/tradingBoard'
import { useMinuteClock } from '../trading/tradingClock'
import { TRADING_PROFIT_STEPS, useTradingSettings, writeTradingSettings } from '../trading/tradingSettings'
import '../styles/economy.css'
import '../styles/trading.css'

type SortKey = 'swing' | 'profit' | 'roi' | 'perSlot' | 'reliability' | 'offers'
const SIGNALS_SHOWN = 6
/** The top of the window: the signals stay in sight under it. */
const ROWS_SHOWN = 15

const KINDS: Array<{ key: 'all' | TradingKind; ru: string; en: string }> = [
  { key: 'all', ru: 'Всё', en: 'All' },
  { key: 'barter', ru: 'Бартер', en: 'Barter' },
  { key: 'gear', ru: 'Снаряжение', en: 'Gear' },
  { key: 'other', ru: 'Прочее', en: 'Other' },
]
const SORTS: Array<{ key: SortKey; ru: string; en: string }> = [
  { key: 'swing', ru: 'Сильнее скачет', en: 'Biggest swing' },
  { key: 'profit', ru: 'Больше выгода', en: 'Biggest profit' },
  { key: 'roi', ru: 'Выгода на вложенный рубль', en: 'Profit per rouble spent' },
  { key: 'perSlot', ru: 'Выгода на клетку', en: 'Profit per stash cell' },
  { key: 'reliability', ru: 'Надёжнее', en: 'Most reliable' },
  { key: 'offers', ru: 'Больше предложений', en: 'Most offers' },
]
const sorters: Record<SortKey, (row: BoardRow) => number> = {
  swing: (row) => row.swing,
  profit: (row) => row.estimate.profit,
  roi: (row) => row.roi,
  perSlot: (row) => row.perSlot,
  reliability: (row) => row.reliability * 1000 + row.row.backtest.signals,
  offers: (row) => row.window.offers,
}

const percent = (value: number, digits = 0) => `${value > 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`
const money = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatPrice(Math.abs(Math.round(value)))}`

/** The week's cheapest offers as a small line: where the price has been, not a chart to read values from. */
function Sparkline({ series, down }: { series: number[]; down: boolean }) {
  if (series.length < 2) return null
  const sorted = [...series].sort((a, b) => a - b)
  // A lone spike would flatten the rest: the line is scaled to the usual range and clipped.
  const low = sorted[Math.floor(sorted.length * 0.02)]!
  const high = sorted[Math.ceil(sorted.length * 0.98) - 1]!
  const range = high - low || 1
  const points = series.map((value, at) => `${((at / (series.length - 1)) * 80).toFixed(1)},${(22 - ((Math.min(high, Math.max(low, value)) - low) / range) * 20).toFixed(1)}`).join(' ')
  return <svg className={`trading-spark ${down ? 'down' : 'up'}`} viewBox="0 0 80 24" aria-hidden="true"><polyline points={points} /></svg>
}

/** The week of one item with its buying and selling zones, and what a trader pays. */
function ZoneChart({ row, trader, locale }: { row: TradingRow; trader: number; locale: 'ru' | 'en' }) {
  const width = 640
  const height = 170
  const sorted = [...row.series].sort((a, b) => a - b)
  const low = Math.min(sorted[0]!, row.buyBelow)
  // A lone spike would squash the zones: the top is the usual high with some air, and a spike leaves the frame.
  const top = Math.max(row.sellAbove, sorted[Math.ceil(sorted.length * 0.97) - 1]!, trader) * 1.04
  const y = (value: number) => 8 + (1 - (Math.min(top, value) - low) / Math.max(1, top - low)) * (height - 16)
  const line = row.series.map((value, at) => `${at ? 'L' : 'M'}${((at / Math.max(1, row.series.length - 1)) * width).toFixed(1)} ${y(value).toFixed(1)}`).join(' ')
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  return <figure className="trading-chart">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={t('Самая низкая цена за неделю', 'The lowest price over the week')}>
      <rect className="zone-sell" x="0" y="0" width={width} height={y(row.sellAbove)} />
      <rect className="zone-buy" x="0" y={y(row.buyBelow)} width={width} height={height - y(row.buyBelow)} />
      {trader > low && trader < top && <line className="trader-line" x1="0" x2={width} y1={y(trader)} y2={y(trader)} vectorEffect="non-scaling-stroke" />}
      <path className="price-line" d={line} vectorEffect="non-scaling-stroke" />
    </svg>
    <figcaption>
      <span className="legend sell">{t('Продавать', 'Sell')} ≥ {formatPrice(row.sellAbove)}</span>
      <span className="legend buy">{t('Покупать', 'Buy')} ≤ {formatPrice(row.buyBelow)}</span>
      {trader > low && trader < top && <span className="legend trader">{t('Торговец', 'Trader')} {formatPrice(trader)}</span>}
      <span className="dim">{t('7 дней, каждая точка: самая низкая цена на момент проверки', '7 days, each point: the lowest price at that check')}</span>
    </figcaption>
  </figure>
}

/** The player's own numbers for one item, and everything known about its past. */
function ItemDetail({ entry, fee, locale }: { entry: BoardRow; fee: ReturnType<typeof feeOptionsFor>; locale: 'ru' | 'en' }) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const { row, estimate, traderPrice, traderName } = entry
  const [paid, setPaid] = useState('')
  const paidValue = Number(paid.replace(/\s/g, ''))
  const buy = paidValue > 0 ? paidValue : entry.current ?? row.buyBelow
  const ask = Math.round(row.sellAbove * 0.99)
  const sale = listing(row, ask, fee)
  const profit = sale.net - buy
  const breakEven = breakEvenAsk(row.base, buy, fee)
  const past = row.backtest
  const clock = (utcHour: number) => {
    const at = new Date()
    at.setUTCHours(utcHour, 0, 0, 0)
    const hour = at.getHours()
    return `${hour}–${(hour + 2) % 24}`
  }
  return <div className="trading-detail">
    <ZoneChart row={row} trader={traderPrice} locale={locale} />
    <div className="trading-detail-grid">
      <section>
        <h4>{t('Расчёт на один предмет', 'One item, worked out')}</h4>
        <dl>
          <div><dt>{paidValue > 0 ? t('Вы купили за', 'You paid') : entry.current !== undefined ? t('Купить сейчас, без комиссии', 'Buy now, no fee') : t('Купить в зоне покупки, без комиссии', 'Buy in the buying zone, no fee')}</dt><dd>{formatPrice(buy)}</dd></div>
          <div><dt>{t('Выставить на барахолку, на 1% дешевле самой низкой цены', 'List on the flea market, 1% under the lowest price')}</dt><dd>{formatPrice(ask)}</dd></div>
          <div><dt>{t('Комиссия за выставление', 'Listing fee')}{fee.intelCenterLevel && fee.intelCenterLevel >= 3 ? t(' (Разведцентр 3 ур.: −30%)', ' (Intelligence Center 3: −30%)') : ''}</dt><dd className="price-down">−{formatPrice(sale.fee)}</dd></div>
          <div className="total"><dt>{t('Останется', 'Left')}</dt><dd>{formatPrice(sale.net)}</dd></div>
          <div className="total"><dt>{t('Оценка выгоды на барахолке', 'Estimated flea profit')}</dt><dd className={profit > 0 ? 'price-up' : 'price-down'}>{money(profit)}</dd></div>
          {traderPrice > 0 && <div className="total"><dt>{t('Или сразу торговцу', 'Or to a trader at once')}: {uiText(traderName ?? '')} {formatPrice(traderPrice)}</dt><dd className={traderPrice - buy > 0 ? 'price-up' : 'price-down'}>{money(traderPrice - buy)}</dd></div>}
        </dl>
        <label className="trading-paid">
          <span>{t('Уже купили? Ваша цена', 'Already bought? Your price')}</span>
          <input className="input" inputMode="numeric" value={paid} placeholder={formatPrice(buy)} onChange={(event) => setPaid(event.target.value.replace(/[^\d\s]/g, ''))} />
        </label>
        <p className="trading-note">{breakEven
          ? <>{t('Без убытка: выставлять не дешевле', 'No loss: list at no less than')} <strong className="mono">{formatPrice(breakEven)}</strong></>
          : t('На барахолке эту цену покупки не вернуть: комиссия съест всё.', 'The flea market will not return this price: the fee takes it all.')}</p>
      </section>
      <section>
        <h4>{t('Как это было в прошлом', 'How it went in the past')} <span className="own-tag" title={t('Этого не было в задании, добавлено для анализа', 'Not in the brief, added for analysis')}>{t('добавлено', 'added')}</span></h4>
        <dl>
          <div><dt>{t('Падений к минимуму за месяц', 'Dips to the low in a month')}</dt><dd>{past.signals}</dd></div>
          <div><dt>{t('Из них в плюс', 'Ended in profit')}</dt><dd>{past.wins} {t('из', 'of')} {past.signals} ({Math.round(entry.reliability * 100)}%)</dd></div>
          <div><dt>{t('Обычно выгода за сделку', 'Usual profit per deal')}</dt><dd className={past.medianProfit > 0 ? 'price-up' : 'price-down'}>{money(past.medianProfit)}</dd></div>
          <div><dt>{t('Обычно ждать до продажи', 'Usual wait to sell')}</dt><dd>{past.medianHours ? t(`${Math.round(past.medianHours)} ч`, `${Math.round(past.medianHours)} h`) : t('сразу', 'none')}</dd></div>
          <div><dt>{t('Самая низкая цена ниже цены торговца', 'Lowest price under the trader’s')}</dt><dd>{Math.round(row.traderShare * 100)}% {t('времени', 'of the time')}</dd></div>
          <div><dt>{t('Предложений на рынке обычно', 'Usual offers on the market')}</dt><dd>{entry.window.offers}</dd></div>
          {row.hours && <div><dt>{t('Обычно дешевле / дороже в ваше время', 'Usually cheaper / dearer, your time')}</dt><dd>{clock(row.hours.cheap)} / {clock(row.hours.dear)} ({t('разница', 'difference')} {Math.round(row.hours.effect * 100)}%)</dd></div>}
          <div><dt>{t('Выгода на клетку', 'Profit per stash cell')} ({row.slots})</dt><dd>{money(entry.perSlot)}</dd></div>
          <div><dt>{t('Выгода на вложенный рубль', 'Profit per rouble spent')}</dt><dd>{percent(entry.roi)}</dd></div>
        </dl>
        {row.trend <= -0.1 && <p className="trading-note warn"><TrendingDown size={13} /> {t(`За сутки цена на ${Math.round(-row.trend * 100)}% ниже обычной: может падать дальше.`, `The last day is ${Math.round(-row.trend * 100)}% below usual: it may keep falling.`)}</p>}
        {row.trend >= 0.1 && <p className="trading-note"><TrendingUp size={13} /> {t(`За сутки цена на ${Math.round(row.trend * 100)}% выше обычной.`, `The last day is ${Math.round(row.trend * 100)}% above usual.`)}</p>}
        {estimate.route === 'trader' && <p className="trading-note">{t('Торговец платит больше, чем останется после комиссии на барахолке: лот не нужен.', 'A trader pays more than a flea listing leaves after the fee: no listing needed.')}</p>}
      </section>
    </div>
  </div>
}

function ReliabilityChip({ entry, locale }: { entry: BoardRow; locale: 'ru' | 'en' }) {
  const tier = reliabilityTier(entry.row.backtest)
  const label = { high: locale === 'en' ? 'High' : 'Высокая', medium: locale === 'en' ? 'Medium' : 'Средняя', low: locale === 'en' ? 'Low' : 'Низкая' }[tier]
  return <span className={`trading-chip ${tier}`} title={locale === 'en' ? `${entry.row.backtest.wins} of ${entry.row.backtest.signals} past dips ended in profit` : `${entry.row.backtest.wins} из ${entry.row.backtest.signals} прошлых падений закончились в плюс`}>{label} {entry.row.backtest.wins}/{entry.row.backtest.signals}</span>
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
      {signal.route === 'flea' && <small className="dim" title={t('Как это обычно выходило за прошлый месяц: покупка по следующей проверке, продажа за 48 часов', 'How it usually went over the past month: bought at the next check, sold within 48 hours')}>{t('в прошлом обычно', 'usually in the past')} {money(entry.row.backtest.medianProfit)}</small>}
      <span className="trading-chips">
        {signal.route === 'flea' ? <ReliabilityChip entry={entry} locale={locale} /> : <span className="trading-chip high">{t('сразу', 'at once')}</span>}
      </span>
    </span>
  </button>
}

/** Item ids of the statistics at this minute's prices. */
function usePricedItems(rows: readonly TradingRow[] | undefined, items: readonly Item[], mode: ReturnType<typeof useAppState>['raidMode'], live: ReturnType<typeof useLivePrices>) {
  return useMemo(() => {
    const wanted = new Set(rows?.map((row) => row.id))
    return new Map(items.filter((item) => wanted.has(item.id)).map((item) => [item.id, withLivePrice(item, mode, live)]))
  }, [items, live, mode, rows])
}

/**
 * «Торговля» in «Экономика» (owner, 05.11.2026: «Купить дешевле, продать дороже»), its own block and not the flea market's
 * page: the items that swing hardest on top (owner: «Сверху показывает топ предметов»), the signals under them, all of it an
 * estimate from history (src/domain/trading.ts).
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
  const items = usePricedItems(snapshot?.rows, data.items, mode, live)
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

  return <div className="page trading-page">
    <header className="page-header">
      <div>
        <div className="eyebrow">{t('Экономика · ', 'Economy · ')}{modeName}</div>
        <h1 className="page-title">{t('Торговля', 'Trading')}</h1>
        <p className="page-subtitle">{t('Купить дешевле, продать дороже: что сильно скачет в цене и когда цена у минимума или максимума. Оценка по истории цен, не гарантия.', 'Buy low, sell high: what swings hard and when a price is at its low or high. An estimate from price history, not a guarantee.')}</p>
      </div>
      {snapshot && <span className={`tag ${stale ? 'danger' : 'green'}`}>{hoursAgo ? t(`статистика: ${hoursAgo} ч назад`, `statistics: ${hoursAgo} h ago`) : t('статистика свежая', 'statistics are fresh')}</span>}
    </header>

    {stats.isLoading && <div className="panel economy-loading" aria-busy="true">{t('Загружаю статистику…', 'Loading the statistics…')}</div>}
    {!stats.isLoading && !snapshot && <div className="panel import-warning"><AlertTriangle size={17} />{t('Статистика по этому режиму ещё собирается. Сервер считает её несколько раз в день, в первый раз это занимает около часа.', 'The statistics for this mode are still being gathered. The server builds them a few times a day; the first time takes about an hour.')}</div>}
    {stale && <div className="panel import-warning"><AlertTriangle size={17} />{t('Статистика устарела: сигналы выключены, пока сервер её не обновит.', 'The statistics are out of date: signals are off until the server renews them.')}</div>}

    {snapshot && level !== undefined && level < MARKET_LEVEL && <div className="panel import-warning"><AlertTriangle size={17} />{t(`Барахолка откроется на ${MARKET_LEVEL} уровне, сейчас у вас ${level}. Здесь показывается только то, что можно купить и продать на вашем уровне.`, `The flea market opens at level ${MARKET_LEVEL}, you are level ${level}. Only what you can buy and sell at your level is shown here.`)}</div>}
    {snapshot && level === undefined && <div className="panel import-warning"><AlertTriangle size={17} />{t('Уровень персонажа в этом режиме ещё не определён, поэтому показаны все предметы и уведомления выключены. Часть предметов может быть закрыта на барахолке.', 'Your level in this mode is not known yet, so all items are shown and notifications are off. Some items may be closed to you on the flea market.')}</div>}

    {snapshot && !pricesReady && <div className="panel economy-loading" aria-busy="true">{t('Жду актуальные цены…', 'Waiting for current prices…')}</div>}

    {snapshot && pricesReady && <>
      <section className="trading-facts" aria-label={t('Коротко о данных', 'About the data')}>
        <div><strong>{rows.length}</strong><span>{level !== undefined ? t(`выгодных и открытых на вашем ${level} уровне`, `profitable and open at your level ${level}`) : t('выгодных предметов', 'profitable items')}</span></div>
        <div><strong>{buys.length}</strong><span>{t('можно покупать сейчас', 'can be bought now')}</span></div>
        <div><strong>{sells.length}</strong><span>{t('можно продавать сейчас', 'can be sold now')}</span></div>
        <div><strong>{Math.round((snapshot.fee.offerFeeRate ?? 0.05) * 100)}%</strong><span>{t('ставка комиссии при продаже, покупка без комиссии', 'fee rate on selling, buying has no fee')}</span></div>
        <label className="trading-notify">
          <span className="economy-check"><input type="checkbox" checked={settings.enabled} onChange={(event) => writeTradingSettings({ enabled: event.target.checked })} /><BellRing size={13} /> {t('Уведомлять', 'Notify')}</span>
          <select className="select" disabled={!settings.enabled} value={settings.minProfit} aria-label={t('Уведомлять от такой выгоды', 'Notify from this profit')} onChange={(event) => writeTradingSettings({ minProfit: Number(event.target.value) })}>
            {TRADING_PROFIT_STEPS.map((step) => <option key={step} value={step}>{t('от', 'from')} {formatPrice(step)}</option>)}
          </select>
        </label>
      </section>

      <section className="panel trading-top">
        <div className="panel-header economy-toolbar">
          <div className="panel-title">{t('Топ: сильнее всего скачут в цене', 'Top: swing hardest in price')}</div>
          <div className="filter-row">
            <div className="mode-switch" role="group" aria-label={t('Период', 'Period')}>
              <button type="button" className={period === 3 ? 'active' : ''} onClick={() => setPeriod(3)}>{t('3 дня', '3 days')}</button>
              <button type="button" className={period === 7 ? 'active' : ''} onClick={() => setPeriod(7)}>{t('Неделя', 'Week')}</button>
            </div>
            <div className="economy-search"><Search size={14} /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Поиск предмета…', 'Search for an item…')} aria-label={t('Поиск предмета', 'Search for an item')} /></div>
            <select className="select" value={kind} aria-label={t('Вид предмета', 'Item kind')} onChange={(event) => setKind(event.target.value as typeof kind)}>{KINDS.map((entry) => <option key={entry.key} value={entry.key}>{locale === 'en' ? entry.en : entry.ru}</option>)}</select>
            <select className="select" value={sort} aria-label={t('Сортировка', 'Sorting')} onChange={(event) => setSort(event.target.value as SortKey)}>{SORTS.map((entry) => <option key={entry.key} value={entry.key}>{locale === 'en' ? entry.en : entry.ru}</option>)}</select>
          </div>
        </div>
        <div className="economy-table-wrap">
          <table className="price-table economy-table trading-table">
            <thead><tr>
              <th>{t('Предмет', 'Item')}</th>
              <th className="num">{t('Сейчас', 'Now')}</th>
              <th className="num">{t('Минимум', 'Low')}</th>
              <th className="num">{t('Максимум', 'High')}</th>
              <th className="num" title={t('Разница обычной низкой и обычной высокой цены, без разовых всплесков', 'The usual low against the usual high, without one-off spikes')}>{t('Скачок', 'Swing')}</th>
              <th className="num">{t('Покупать до', 'Buy under')}</th>
              <th className="num">{t('Продавать от', 'Sell over')}</th>
              <th className="num">{t('Выгода (оценка)', 'Profit (estimate)')}</th>
              <th>{t('Надёжность', 'Reliability')}</th>
              <th className="num">{t('Предложений', 'Offers')}</th>
              <th>{t('7 дней', '7 days')}</th>
            </tr></thead>
            <tbody>
              {visible.map((entry) => <RowView key={entry.row.id} entry={entry} expanded={selected === entry.row.id} onToggle={() => open(entry.row.id)} fee={fee} locale={locale} />)}
              {visible.length === 0 && <tr><td colSpan={11} className="muted">{t('Под этот отбор ничего не подходит.', 'Nothing matches this filter.')}</td></tr>}
            </tbody>
          </table>
        </div>
        {shown.length > ROWS_SHOWN && <button type="button" className="button ghost trading-more" onClick={() => setAllRows((value) => !value)}>{allRows ? t('Свернуть', 'Show fewer') : t(`Показать все: ${shown.length}`, `Show all: ${shown.length}`)}</button>}
      </section>

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
          <li>{t('Покупать до и продавать от: самые дешёвые 10% и самые дорогие 15% проверок за неделю, а не разовый минимум и максимум, которые долго не держатся.', 'Buy under and sell over: the cheapest 10% and the dearest 15% of the week’s checks, not a one-off low and high that never last.')}</li>
          <li>{t('Цены приходят с задержкой до полутора часов: дешёвого лота к этому времени может уже не быть. Поэтому «как это было в прошлом» считается так, будто вы купили уже по следующей проверке.', 'Prices arrive up to an hour and a half late: the cheap listing may be gone by then. So «how it went in the past» counts as if you bought at the next check.')}</li>
          <li>{t('Лот может не продаться: комиссия не вернётся, а репутация барахолки упадёт. Число своих лотов тоже ограничено репутацией. Данных о реальных сделках нет, известны только цены и число предложений.', 'A listing may not sell: the fee is not returned and flea reputation falls. Reputation also limits how many listings you can have. There is no data on actual deals, only prices and the number of offers.')}</li>
          <li>{t('Предметы, у которых копии бывают разными, здесь не рассматриваются: оружие, броня, шлемы, ключи, аптечки, лекарства на несколько применений, вода, топливо, фильтры, ремонтные наборы. Самый дешёвый такой лот часто неполный, и его цена говорит об износе, а не о рынке.', 'Items whose copies differ are not looked at here: weapons, armor, helmets, keys, medkits, medicine of several uses, water, fuel, filters, repair kits. The cheapest such listing is often not a whole one, and its price tells about wear, not the market.')}</li>
          <li>{t('Показано только то, что барахолка открывает на вашем уровне в этом режиме: и для покупки, и для продажи.', 'Only what the flea market opens at your level in this mode is shown: both to buy and to sell.')}</li>
          <li>{t('Купленное на барахолке не считается «найдено в рейде»: для квестов и убежища, где это нужно, такой предмет не подойдёт.', 'What you buy on the flea market is not «found in raid»: it will not do for quests and hideout levels that ask for it.')}</li>
        </ul>
      </section>
    </>}
  </div>
}

function RowView({ entry, expanded, onToggle, fee, locale }: { entry: BoardRow; expanded: boolean; onToggle: () => void; fee: ReturnType<typeof feeOptionsFor>; locale: 'ru' | 'en' }) {
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const { row, window, signal } = entry
  // Between the buying and the selling zone: against the low and high, one spike would push every price to one edge.
  const position = entry.current === undefined ? null : Math.min(1, Math.max(0, (entry.current - row.buyBelow) / Math.max(1, row.sellAbove - row.buyBelow)))
  return <>
    <tr className={`trading-row ${expanded ? 'open' : ''} ${signal ? `has-${signal.kind}` : ''}`} onClick={onToggle}>
      <td>
        <div className="trading-item">
          <img src={entry.item.iconUrl} alt="" loading="lazy" className="economy-thumb" />
          <span className="economy-line-text">
            <button type="button" className="trading-name" aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); onToggle() }}>{uiText(entry.item.name)} {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
            <small className="dim">
              {entry.estimate.route === 'trader' ? `${t('торговцу', 'to a trader')}: ${uiText(entry.traderName ?? '')}` : t('через барахолку', 'via the flea market')}
            </small>
          </span>
        </div>
      </td>
      <td className="num mono">
        {entry.current !== undefined ? <>
          <span className={signal?.kind === 'buy' ? 'price-up' : signal?.kind === 'sell' ? 'price-down' : ''}>{formatPrice(entry.current)}</span>
          {position !== null && <span className="trading-range" aria-hidden="true"><i style={{ left: `${position * 100}%` }} /></span>}
        </> : <span className="dim">{t('нет лотов', 'no offers')}</span>}
      </td>
      <td className="num mono">{formatPrice(window.min)}</td>
      <td className="num mono">{formatPrice(window.max)}</td>
      <td className="num mono">{percent(entry.swing)}</td>
      <td className="num mono">{formatPrice(row.buyBelow)}</td>
      <td className="num mono">{formatPrice(row.sellAbove)}</td>
      <td className="num mono price-up">{money(entry.estimate.profit)}<small className="dim trading-sub">{percent(entry.roi)}</small></td>
      <td><ReliabilityChip entry={entry} locale={locale} /></td>
      <td className="num mono">{window.offers}</td>
      <td><Sparkline series={row.series} down={(entry.move ?? 0) < 0} /></td>
    </tr>
    {expanded && <tr className="trading-detail-row"><td colSpan={11}><ItemDetail entry={entry} fee={fee} locale={locale} /></td></tr>}
  </>
}
