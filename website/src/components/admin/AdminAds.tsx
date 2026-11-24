import { Copy, Megaphone } from 'lucide-react'
import { useCallback, useState } from 'react'
import { adLink } from '../../../../src/shared/adSources'
import { api, type AdminAdSource, type StatsPeriod } from '../../api'
import { Notice } from '../Notice'
import { Loading } from './adminShared'
import { formatPeriodKey, formatRub, numberFormat, useAdminData } from './adminData'

const PERIODS: Array<{ id: StatsPeriod; label: string }> = [
  { id: 'day', label: 'По дням' },
  { id: 'month', label: 'По месяцам' },
  { id: 'year', label: 'По годам' },
]

/**
 * «Реклама» (owner, 09.11.2026: «сколько человек пришло с Reddit рекламы»): the link for the ads, then visits,
 * registrations (site and app) and payments from it — in total, per day / month / year and per campaign (Bangkok days).
 */
export function AdminAds() {
  const [period, setPeriod] = useState<StatsPeriod>('day')
  const ads = useAdminData(useCallback((t: string) => api.adminAds(t, period), [period]))
  return (
    <section className="panel owner-panel" aria-labelledby="admin-ads-title">
      <div className="panel-header">
        <div className="panel-title" id="admin-ads-title"><Megaphone size={16} aria-hidden="true" /> Реклама</div>
      </div>
      <div className="panel-body owner-body admin-stack">
        <div role="group" aria-label="Период статистики" className="admin-chips">
          {PERIODS.map(({ id, label }) => <button key={id} type="button" aria-pressed={period === id} className={`button small ${period === id ? 'primary' : 'ghost'}`} onClick={() => setPeriod(id)}>{label}</button>)}
        </div>
        {ads.error && <Notice tone={ads.error.offline ? 'offline' : 'error'}>{ads.error.message}</Notice>}
        {(!ads.data || ads.data.period !== period) && !ads.error && <Loading />}
        {ads.data?.period === period && ads.data.sources.map((source) => <AdSourceBlock key={source.source} source={source} />)}
      </div>
    </section>
  )
}

function AdSourceBlock({ source }: { source: AdminAdSource }) {
  const { totals } = source
  return (
    <div className="owner-block admin-stack">
      <div className="field-label">{source.label}</div>
      <div className="table-scroll">
        <table className="pay-table admin-table">
          <thead><tr><th scope="col">Переходы</th><th scope="col">Регистрации</th><th scope="col">Оплаты</th><th scope="col">Оплатили</th><th scope="col">Выручка</th></tr></thead>
          <tbody><tr>
            <td className="mono">{numberFormat.format(totals.visits)}</td>
            <td className="mono">{numberFormat.format(totals.registrations)}</td>
            <td className="mono">{numberFormat.format(totals.payments)}</td>
            <td className="mono">{numberFormat.format(totals.payers)}</td>
            <td className="mono">{formatRub(totals.revenue)} ₽</td>
          </tr></tbody>
        </table>
      </div>
      <AdLink source={source} />
      <div className="table-scroll">
        <table className="pay-table admin-table" aria-label={`${source.label}: статистика`}>
          <thead><tr><th scope="col">Период</th><th scope="col">Переходы</th><th scope="col">Регистрации</th><th scope="col">Оплаты</th><th scope="col">Выручка</th></tr></thead>
          <tbody>
            {source.rows.map((row) => (
              <tr key={row.period} className={!row.visits && !row.registrations && !row.payments ? 'dim' : undefined}>
                <th scope="row">{formatPeriodKey(row.period)}</th>
                <td className="mono">{numberFormat.format(row.visits)}</td>
                <td className="mono">{numberFormat.format(row.registrations)}</td>
                <td className="mono">{numberFormat.format(row.payments)}</td>
                <td className="mono">{formatRub(row.revenue)} ₽</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {source.campaigns.length > 0 && (
        <div className="table-scroll">
          <table className="pay-table admin-table" aria-label={`${source.label}: кампании`}>
            <thead><tr><th scope="col">Кампания</th><th scope="col">Переходы</th><th scope="col">Регистрации</th><th scope="col">Оплаты</th><th scope="col">Выручка</th></tr></thead>
            <tbody>
              {source.campaigns.map((row) => (
                <tr key={row.campaign}>
                  <th scope="row">{row.campaign ? <span className="mono">{row.campaign}</span> : <span className="dim">без названия</span>}</th>
                  <td className="mono">{numberFormat.format(row.visits)}</td>
                  <td className="mono">{numberFormat.format(row.registrations)}</td>
                  <td className="mono">{numberFormat.format(row.payments)}</td>
                  <td className="mono">{formatRub(row.revenue)} ₽</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** The link to put in the ad; the campaign's name (optional) goes after utm_campaign=. */
function AdLink({ source }: { source: AdminAdSource }) {
  const [campaign, setCampaign] = useState('')
  const [copied, setCopied] = useState(false)
  const link = adLink(source.source, campaign)
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true) } catch { setCopied(false) } }
  return (
    <div className="admin-stack">
      <label className="field-label" htmlFor={`ad-campaign-${source.source}`}>Ссылка для объявлений · название кампании по желанию</label>
      <input id={`ad-campaign-${source.source}`} className="input mono" value={campaign} maxLength={32} spellCheck={false} autoComplete="off" placeholder="tarkov" onChange={(event) => { setCampaign(event.target.value); setCopied(false) }} />
      <div className="admin-row-actions">
        <code className="mono">{link}</code>
        <button type="button" className="button small ghost" onClick={() => void copy()}><Copy aria-hidden="true" />{copied ? 'Скопировано' : 'Скопировать'}</button>
      </div>
    </div>
  )
}
