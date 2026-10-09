import { useMemo, useState } from 'react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import type { RaidMode } from '../domain/types'
import { usePriceHistory } from '../data/useEconomy'
import { chartGeometry, lastDays } from '../shared/priceChart'
import { formatPrice } from '../shared/format'
import '../styles/economy.css'

const WIDTH = 320
const HEIGHT = 96

/** Flea price history (tarkov.dev `historicalItemPrices`) for the selected mode: a small inline SVG line, 7 or 30 days. */
export function PriceHistoryChart({ itemId, mode }: { itemId: string; mode: RaidMode }) {
  const { locale } = useLocale()
  const [days, setDays] = useState<7 | 30>(7)
  const [hover, setHover] = useState<number | null>(null)
  const { data, isLoading, isError, supported } = usePriceHistory(itemId, mode)
  const points = useMemo(() => lastDays(data ?? [], days), [data, days])
  const geometry = useMemo(() => chartGeometry(points, WIDTH, HEIGHT), [points])
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), [locale])
  const active = geometry && hover !== null ? geometry.coords[hover] : null

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!geometry) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * WIDTH
    let best = 0
    geometry.coords.forEach((coord, index) => { if (Math.abs(coord.x - x) < Math.abs(geometry.coords[best].x - x)) best = index })
    setHover(best)
  }

  let body: React.ReactNode
  if (!supported) body = <p className="muted price-chart-note">{uiText('Для Сезона нет отдельной истории цен.')}</p>
  else if (isLoading) body = <div className="price-chart-skeleton" aria-busy="true" />
  else if (isError) body = <p className="muted price-chart-note">{uiText('История цены сейчас недоступна.')}</p>
  else if (!geometry) body = <p className="muted price-chart-note">{uiText('Недостаточно данных за период.')}</p>
  else {
    const trend = geometry.change >= 0 ? 'up' : 'down'
    body = <>
      <div className="price-chart-summary">
        <strong className="mono">{formatPrice(active ? active.point.price : geometry.last)}</strong>
        {active
          ? <span className="dim mono">{dateFormat.format(active.point.timestamp)}</span>
          : <span className={`mono price-chart-change ${trend}`}>{geometry.change >= 0 ? '+' : ''}{geometry.change.toFixed(1)}%</span>}
      </div>
      <svg className={`price-chart ${trend}`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img"
        aria-label={uiText(`История цены за ${days} дн.`)} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <path className="price-chart-area" d={geometry.area} />
        <path className="price-chart-line" d={geometry.line} vectorEffect="non-scaling-stroke" />
        {active && <line className="price-chart-cursor" x1={active.x} x2={active.x} y1={0} y2={HEIGHT} vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="price-chart-scale mono"><span>{uiText('мин')} {formatPrice(geometry.min)}</span><span>{uiText('макс')} {formatPrice(geometry.max)}</span></div>
    </>
  }

  return <div className="detail-section price-history">
    <div className="price-history-head">
      <h4>{uiText('История цены · ')}{uiText(mode === 'seasonal' ? 'Сезон' : mode.toUpperCase())}</h4>
      <div className="mode-switch" role="group" aria-label={uiText('Период')}>
        {([7, 30] as const).map((value) => <button key={value} type="button" className={days === value ? 'active' : ''} onClick={() => setDays(value)}>{uiText(`${value} дн.`)}</button>)}
      </div>
    </div>
    {body}
  </div>
}
