import { useEffect, useState } from 'react'
import { ArrowLeft, Copy, CreditCard, Megaphone, MousePointerClick, UserPlus, Wallet, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { adLink } from '../shared/adSources'
import { adminApi, type AdminAds, type AdminAdSource, type StatsPeriod } from './adminApi'
import { count, errorText, money } from './adminFormat'
import { AdminLoading } from './adminShared'

const PERIODS: Array<{ id: StatsPeriod; label: string }> = [
  { id: 'day', label: 'По дням' },
  { id: 'month', label: 'По месяцам' },
  { id: 'year', label: 'По годам' },
]
const dayLabel = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const periodLabel = (period: string) => period.length === 10 ? dayLabel.format(new Date(`${period}T12:00:00Z`)) : period.length === 7 ? monthLabel.format(new Date(`${period}-15T12:00:00Z`)) : period

/**
 * «Реклама» of the admin app (owner, 09.11.2026: «сколько человек пришло с Reddit рекламы»): the link for the ads, then
 * visits, registrations and payments from it — in total, per day / month / year and per campaign (Bangkok days).
 */
export function AdsSheet({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<StatsPeriod>('day')
  const [result, setResult] = useState<{ period: StatsPeriod; data?: AdminAds; error?: string } | null>(null)
  useEffect(() => {
    let active = true
    adminApi.ads(period).then(
      (data) => { if (active) setResult({ period, data }) },
      (reason: unknown) => { if (active) setResult({ period, error: errorText(reason) }) },
    )
    return () => { active = false }
  }, [period])
  const data = result?.period === period ? result.data ?? null : null
  const error = result?.period === period ? result.error ?? '' : ''

  return <div className="admin-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="panel admin-user-sheet admin-wide-sheet" role="dialog" aria-modal="true" aria-label={uiText('Реклама')}>
      <header className="admin-sheet-head"><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Назад')}><ArrowLeft size={18} /></button><div><strong>{uiText('Реклама')}</strong><small>{uiText('Переходы, регистрации и оплаты')}</small></div><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button></header>
      <div className="admin-sheet-scroll">
        {error && <div className="admin-inline-error" role="alert">{uiText(error)}</div>}
        {!data && !error && <AdminLoading />}
        {data?.sources.map((source) => <AdSourceBlock key={source.source} source={source} period={period} onPeriod={setPeriod} />)}
      </div>
    </section>
  </div>
}

function AdSourceBlock({ source, period, onPeriod }: { source: AdminAdSource; period: StatsPeriod; onPeriod: (period: StatsPeriod) => void }) {
  const { totals } = source
  return <>
    <h2 className="admin-sheet-title">{source.label}</h2>
    <div className="admin-overview admin-streamer-cards">
      <article><span><MousePointerClick size={16} />{uiText('Переходы')}</span><strong>{count.format(totals.visits)}</strong><small>{uiText('за всё время')}</small></article>
      <article><span><UserPlus size={16} />{uiText('Регистрации')}</span><strong>{count.format(totals.registrations)}</strong><small>{uiText('сайт и приложение')}</small></article>
      <article><span><CreditCard size={16} />{uiText('Оплаты')}</span><strong>{count.format(totals.payments)}</strong><small>{uiText(`оплатили: ${count.format(totals.payers)}`)}</small></article>
      <article><span><Wallet size={16} />{uiText('Выручка')}</span><strong>{money(totals.revenue)}</strong><small>{uiText('за всё время')}</small></article>
    </div>
    <AdLinkCard source={source} />
    <div className="admin-streamer-series">
      <div className="admin-chip-row" role="group" aria-label={uiText('Период статистики')}>
        {PERIODS.map((item) => <button type="button" key={item.id} className={period === item.id ? 'active' : ''} aria-pressed={period === item.id} onClick={() => onPeriod(item.id)}>{uiText(item.label)}</button>)}
      </div>
      <div className="admin-series-table admin-streamer-table" role="table" aria-label={uiText(`${source.label}: статистика`)}>
        <div className="admin-series-row header" role="row"><span role="columnheader">{uiText('Период')}</span><span role="columnheader">{uiText('Перех.')}</span><span role="columnheader">{uiText('Рег.')}</span><span role="columnheader">{uiText('Оплат')}</span><span role="columnheader">{uiText('Выручка')}</span></div>
        {source.rows.map((row) => <div className={`admin-series-row${!row.visits && !row.registrations && !row.payments ? ' is-zero' : ''}`} role="row" key={row.period}>
          <span role="rowheader">{uiText(periodLabel(row.period))}</span>
          <strong role="cell">{count.format(row.visits)}</strong>
          <strong role="cell">{count.format(row.registrations)}</strong>
          <strong role="cell">{count.format(row.payments)}</strong>
          <strong role="cell" className="is-money">{money(row.revenue)}</strong>
        </div>)}
      </div>
    </div>
    {source.campaigns.length > 0 && <>
      <h2 className="admin-sheet-title">{uiText('Кампании')}</h2>
      <div className="admin-series-table admin-streamer-table" role="table" aria-label={uiText(`${source.label}: кампании`)}>
        <div className="admin-series-row header" role="row"><span role="columnheader">{uiText('Кампания')}</span><span role="columnheader">{uiText('Перех.')}</span><span role="columnheader">{uiText('Рег.')}</span><span role="columnheader">{uiText('Оплат')}</span><span role="columnheader">{uiText('Выручка')}</span></div>
        {source.campaigns.map((row) => <div className="admin-series-row" role="row" key={row.campaign}>
          <span role="rowheader">{row.campaign || uiText('без названия')}</span>
          <strong role="cell">{count.format(row.visits)}</strong>
          <strong role="cell">{count.format(row.registrations)}</strong>
          <strong role="cell">{count.format(row.payments)}</strong>
          <strong role="cell" className="is-money">{money(row.revenue)}</strong>
        </div>)}
      </div>
    </>}
  </>
}

/** The link to put in the ad; the campaign's name (optional) goes after utm_campaign=. */
function AdLinkCard({ source }: { source: AdminAdSource }) {
  const [campaign, setCampaign] = useState('')
  const [copied, setCopied] = useState(false)
  const link = adLink(source.source, campaign)
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true) } catch { setCopied(false) } }
  return <div className="admin-grant-card admin-streamer-invite">
    <div className="admin-card-heading"><Megaphone size={18} /><div><strong>{uiText('Ссылка для объявлений')}</strong><small>{uiText('Название кампании — по желанию')}</small></div></div>
    <div className="admin-invite-row">
      <input className="input" aria-label={uiText('Название кампании')} value={campaign} maxLength={32} spellCheck={false} autoComplete="off" placeholder="tarkov" onChange={(event) => { setCampaign(event.target.value); setCopied(false) }} />
    </div>
    <div className="admin-invite-result">
      <code>{link}</code>
      <button type="button" className="button ghost small" onClick={() => void copy()}><Copy size={14} />{uiText(copied ? 'Скопировано' : 'Скопировать')}</button>
    </div>
  </div>
}
