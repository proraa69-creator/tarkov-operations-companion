import { useMemo, useState } from 'react'
import { priceForecast, rowScans, sellForecast, type TradingRow } from '../domain/trading'
import { formatPrice } from '../shared/format'
import { chartModel, periodScans, type ChartMark } from './tradingChartModel'
import type { TradingPeriod } from './tradingBoard'

const HEIGHT = 300
const shortPrice = (value: number) => new Intl.NumberFormat('ru-RU').format(Math.round(value))

function Mark({ mark, label, color, width, below }: { mark: ChartMark; label: string; color: string; width: number; below?: boolean }) {
  const anchor = mark.x > width - 170 ? 'end' : mark.x < 170 ? 'start' : 'middle'
  const y = below ? Math.min(mark.y + 16, 270) : Math.max(mark.y - 8, 24)
  return <g className="trading-mark">
    <circle cx={mark.x} cy={mark.y} r={3.5} fill={color} />
    <text x={mark.x} y={y} textAnchor={anchor} fill={color}>{label}</text>
  </g>
}

/**
 * The price of the chosen period with its dates and hours, «now», and the next two days dashed as the same hours of the past
 * week were (owner, 05.11.2026: «график с ценой и датами часами, и там же прогноз цены»). The line of the needed price and the
 * time it usually comes move with the sum the player chooses.
 */
export function TradingChart({ row, period, current, target, trader, now, width, locale }: {
  row: TradingRow
  period: TradingPeriod
  current?: number
  target?: number
  trader?: number
  now: number
  width: number
  locale: 'ru' | 'en'
}) {
  const [hover, setHover] = useState<number | null>(null)
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const scans = useMemo(() => periodScans(row, period), [period, row])
  const forecast = useMemo(() => priceForecast(rowScans(row), now), [now, row])
  const sell = useMemo(() => target ? sellForecast(rowScans(row), target, current, now) : undefined, [current, now, row, target])
  const model = useMemo(() => chartModel({ scans, forecast, now, current, target, trader, sell, width, height: HEIGHT }), [current, forecast, now, scans, sell, target, trader, width])
  const dayFormat = useMemo(() => new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', { day: '2-digit', month: '2-digit' }), [locale])
  const hourFormat = useMemo(() => new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', { hour: '2-digit', minute: '2-digit' }), [locale])
  const stamp = (at: number) => `${dayFormat.format(at)} ${hourFormat.format(at)}`
  if (!model) return <p className="muted trading-empty">{t('Мало данных для графика.', 'Too little data for a chart.')}</p>
  const active = hover === null ? null : model.points[hover] ?? null
  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    let best = 0
    model.points.forEach((point, index) => { if (Math.abs(point.x - x) < Math.abs(model.points[best]!.x - x)) best = index })
    setHover(best)
  }
  return <figure className="trading-chart" style={{ width }}>
    <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img"
      aria-label={t('График самой низкой цены с датами и прогнозом', 'Chart of the lowest price with dates and a forecast')}
      onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      {model.yTicks.map((tick) => <g key={tick.price}>
        <line className="grid" x1={model.left} x2={model.right} y1={tick.y} y2={tick.y} />
        <text className="axis" x={model.left - 6} y={tick.y + 4} textAnchor="end">{shortPrice(tick.price)}</text>
      </g>)}
      {model.xTicks.map((tick) => <g key={tick.at}>
        <line className={tick.day ? 'grid day' : 'grid'} x1={tick.x} x2={tick.x} y1={model.top} y2={model.bottom} />
        <text className={tick.day ? 'axis day' : 'axis'} x={tick.x} y={model.bottom + 16} textAnchor="middle">{tick.day ? dayFormat.format(tick.at) : hourFormat.format(tick.at)}</text>
      </g>)}
      <rect className="future" x={model.nowX} y={model.top} width={Math.max(0, model.right - model.nowX)} height={model.bottom - model.top} />
      {model.sellBand && <rect className="sell-time" x={model.sellBand.x} y={model.top} width={model.sellBand.width} height={model.bottom - model.top} />}
      {model.forecastBand && <path className="forecast-band" d={model.forecastBand} />}
      {model.traderY !== undefined && <line className="trader-line" x1={model.left} x2={model.right} y1={model.traderY} y2={model.traderY} />}
      {model.targetY !== undefined && <line className="target-line" x1={model.left} x2={model.right} y1={model.targetY} y2={model.targetY} />}
      <line className="now-line" x1={model.nowX} x2={model.nowX} y1={model.top} y2={model.bottom} />
      <text className="now-label" x={model.nowX} y={model.top - 3} textAnchor="middle">{t('сейчас', 'now')}</text>
      <path className="price-line" d={model.line} />
      <path className="forecast-line" d={model.forecastLine} />
      {model.low && <Mark mark={model.low} width={width} below color="#7fc48f" label={`${t('мин', 'low')} ${formatPrice(model.low.price)} · ${stamp(model.low.at)}`} />}
      {model.high && <Mark mark={model.high} width={width} color="#d48b80" label={`${t('макс', 'high')} ${formatPrice(model.high.price)} · ${stamp(model.high.at)}${model.high.offChart ? ' ▲' : ''}`} />}
      {active && <g>
        <line className="cursor" x1={active.x} x2={active.x} y1={model.top} y2={model.bottom} />
        <circle cx={active.x} cy={active.y} r={3.5} className="cursor-dot" />
      </g>}
    </svg>
    {active && <div className="trading-chart-tip" style={{ left: Math.min(active.x + 10, width - 170), top: Math.max(4, active.y - 44) }}>
      <strong className="mono">{active.forecast ? '~' : ''}{formatPrice(active.price)}</strong>
      <span>{stamp(active.at)}{active.forecast ? ` · ${t('прогноз', 'forecast')}` : ''}</span>
    </div>}
    <figcaption>
      <span className="legend past">{t('цена', 'price')}</span>
      <span className="legend ahead">{t('прогноз по прошлым графикам', 'forecast from past charts')}</span>
      {target && <span className="legend target">{t('нужная цена', 'needed price')} {formatPrice(target)}</span>}
      {model.sellBand && <span className="legend time">{t('когда обычно доходит', 'when it usually gets there')}</span>}
      {model.traderY !== undefined && trader && <span className="legend trader">{t('торговец', 'trader')} {formatPrice(trader)}</span>}
    </figcaption>
  </figure>
}
