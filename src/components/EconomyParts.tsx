import { NavLink } from 'react-router-dom'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { PricedLine } from '../domain/economy'
import { formatPrice } from '../shared/format'
import '../styles/economy.css'

const TABS = [
  { to: '/economy', label: 'Рейтинг ценности' },
  { to: '/economy/barters', label: 'Бартеры' },
  { to: '/economy/crafts', label: 'Крафты' },
]

/** Sub-navigation shared by the «Экономика» pages. */
export function EconomyTabs() {
  return <nav className="mode-switch economy-tabs" aria-label={uiText('Экономика')}>
    {TABS.map((tab) => <NavLink key={tab.to} to={tab.to} end className={({ isActive }) => isActive ? 'active' : ''}>{uiText(tab.label)}</NavLink>)}
  </nav>
}

/** Items of one side of a barter/craft: icon, count, name and the price source used. */
export function ItemLines({ lines, side }: { lines: PricedLine[]; side: 'buy' | 'sell' }) {
  return <ul className="economy-lines">
    {lines.map((line) => <li key={line.itemId} title={uiText(line.name)}>
      {line.iconUrl ? <img className="economy-thumb" src={line.iconUrl} alt="" loading="lazy" /> : <span className="economy-thumb" />}
      <span className="economy-line-text">
        <span className="economy-line-name">{line.count > 1 && <b className="mono">{line.count}× </b>}{uiText(line.shortName)}</span>
        <small className="dim">{line.choice
          ? <>{uiText(line.choice.source)} · <span className="mono">{formatPrice(Math.round(line.choice.unitPrice))}</span>{side === 'sell' && line.choice.fee ? <> {uiText('(после комиссии)')}</> : null}{line.choice.average ? <> {uiText('(среднее за 24 ч)')}</> : null}</>
          : uiText(side === 'buy' ? 'нельзя купить' : 'нет цены')}</small>
      </span>
    </li>)}
  </ul>
}

export function ProfitCell({ profit, percent, perHour }: { profit: number | null; percent?: number | null; perHour?: number | null }) {
  if (profit === null) return <span className="dim">—</span>
  const tone = profit > 0 ? 'price-up' : profit < 0 ? 'price-down' : 'dim'
  return <span className={`economy-profit ${tone}`}>
    <strong className="mono">{profit > 0 ? '+' : ''}{formatPrice(Math.round(profit))}</strong>
    {percent !== undefined && percent !== null && <small className="mono">{percent > 0 ? '+' : ''}{percent.toFixed(1)}%</small>}
    {perHour !== undefined && perHour !== null && <small className="mono">{perHour > 0 ? '+' : ''}{formatPrice(Math.round(perHour))}{uiText('/ч')}</small>}
  </span>
}

/** Loading / error / Season states shared by the barter and craft pages. */
export function EconomyStatus({ supported, isLoading, error }: { supported: boolean; isLoading: boolean; error: unknown }) {
  if (!supported) return <div className="panel import-warning"><AlertTriangle size={17} />{uiText('Для Сезона нет отдельных цен бартеров и крафтов. Цены PvP здесь не подставляются, чтобы не смешивать режимы — переключитесь на PvP или PvE.')}</div>
  if (isLoading) return <div className="panel economy-loading"><LoaderCircle size={17} className="spin" />{uiText('Загружаем цены, бартеры и крафты…')}</div>
  if (error) return <div className="panel import-warning"><AlertTriangle size={17} /><span>{uiText('Источник цен сейчас недоступен, а сохранённых данных для этого режима нет. Попробуйте обновить позже.')}{errorText(error) && <small className="dim economy-error-detail">{uiText('Причина')}: {errorText(error)}</small>}</span></div>
  return null
}

/** The reason under the warning, so a failure can be told apart (network, timeout, an answer from tarkov.dev). */
function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 300)
}
