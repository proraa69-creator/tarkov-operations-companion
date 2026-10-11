import { LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, errorMessage, type PlanId, type ReferralSeriesRow, type StatsPeriod } from '../api'
import { localeTag, tr } from '../i18n'
import { Notice } from './Notice'

/** The labels are Russian source texts, shown through tr(). */
const STATS_PERIODS: { id: StatsPeriod; label: string }[] = [
  { id: 'day', label: 'По дням' },
  { id: 'month', label: 'По месяцам' },
  { id: 'year', label: 'По годам' },
]
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const MONTHS_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const PLAN_IDS: PlanId[] = ['1m', '3m', '6m', '12m']
/** Number formats per site language (src/i18n localeTag()): built once, the admin tables format many cells. */
const formats = new Map<string, Intl.NumberFormat>()
function numberFormat(minimumFractionDigits: number) {
  const key = `${localeTag()}:${minimumFractionDigits}`
  let format = formats.get(key)
  if (!format) formats.set(key, format = new Intl.NumberFormat(localeTag(), { minimumFractionDigits, maximumFractionDigits: 2 }))
  return format
}
const formatNumber = (value: number) => numberFormat(0).format(value)

/** Whole roubles without kopecks, otherwise always two digits (119,60; 119.60 on the English site). */
export const formatRub = (amount: number) => {
  const rounded = Math.round(amount * 100) / 100
  return numberFormat(Number.isInteger(rounded) ? 0 : 2).format(rounded)
}

/**
 * 2026-10-01 → «1 окт 2026», 2026-10 → «Октябрь 2026», 2026 → «2026». Russian by default (the owner's admin pages);
 * `english` gives «Oct 1, 2026» / «October 2026» for the English site.
 */
export function formatPeriodKey(key: string, english = false) {
  const [year, month, day] = key.split('-')
  const m = Number(month) - 1
  if (english && month && MONTHS_FULL[m]) {
    const date = new Date(Date.UTC(Number(year), m, day ? Number(day) : 1))
    return new Intl.DateTimeFormat('en-US', day ? { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' } : { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
  }
  if (day) return `${Number(day)} ${MONTHS_SHORT[m] ?? month} ${year}`
  if (month) return `${MONTHS_FULL[m] ?? month} ${year}`
  return year
}

/**
 * Referral statistics per day, month or year with a totals row. The streamer's own table shows his earnings only;
 * the owner's view of a streamer (`showRevenue`) adds what the referred users paid.
 */
export function ReferralStatsTable({ load, showRevenue = false, title = 'Статистика' }: {
  load: (period: StatsPeriod) => Promise<{ rows: ReferralSeriesRow[] }>
  showRevenue?: boolean
  title?: string
}) {
  const [period, setPeriod] = useState<StatsPeriod>('day')
  const [result, setResult] = useState<{ period: StatsPeriod; rows: ReferralSeriesRow[] } | null>(null)
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    load(period).then(
      (next) => { if (!cancelled) { setResult({ period, rows: next.rows }); setError(null) } },
      (reason: unknown) => { if (!cancelled) setError({ message: errorMessage(reason), offline: reason instanceof ApiError && reason.network }) },
    )
    return () => { cancelled = true }
  }, [load, period])

  const rows = result?.period === period ? result.rows : null
  const english = localeTag() === 'en-US'
  const total = rows?.reduce<ReferralSeriesRow>((sum, row) => ({
    period: '', visits: sum.visits + row.visits, registrations: sum.registrations + row.registrations, payments: sum.payments + row.payments,
    months: { '1m': sum.months['1m'] + row.months['1m'], '3m': sum.months['3m'] + row.months['3m'], '6m': sum.months['6m'] + row.months['6m'], '12m': sum.months['12m'] + row.months['12m'] },
    revenue: (sum.revenue ?? 0) + (row.revenue ?? 0), earnings: sum.earnings + row.earnings,
  }), { period: '', visits: 0, registrations: 0, payments: 0, months: { '1m': 0, '3m': 0, '6m': 0, '12m': 0 }, revenue: 0, earnings: 0 })
  const cells = (row: ReferralSeriesRow) => (
    <>
      <td className="num mono">{formatNumber(row.visits)}</td>
      <td className="num mono">{formatNumber(row.registrations)}</td>
      <td className="num mono">{formatNumber(row.payments)}</td>
      <td className="mono terms">{PLAN_IDS.filter((id) => row.months[id]).map((id) => `${tr('{months}м', { months: id.replace('m', '') })}: ${formatNumber(row.months[id])}`).join(' · ') || '—'}</td>
      {showRevenue && <td className="num mono">{formatRub(row.revenue ?? 0)}</td>}
      <td className="num mono accent">{formatRub(row.earnings)}</td>
    </>
  )

  return (
    <div className="ref-series">
      <div className="ref-series-head">
        <div className="field-label">{tr(title)}</div>
        <div role="tablist" aria-label={tr('Период')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATS_PERIODS.map(({ id, label }) => (
            <button key={id} type="button" role="tab" aria-selected={period === id} className={`button small ${period === id ? 'primary' : 'ghost'}`} onClick={() => setPeriod(id)}>{tr(label)}</button>
          ))}
        </div>
      </div>
      {error && <Notice tone={error.offline ? 'offline' : 'error'}>{tr(error.message)}</Notice>}
      {!rows && !error && <div className="muted" style={{ fontSize: 14 }}><LoaderCircle className="spinner" size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />{tr('Загружаем статистику…')}</div>}
      {rows && rows.length === 0 && <div className="muted" style={{ fontSize: 14 }}>{tr('Пока нет данных — они появятся после первых переходов по ссылке.')}</div>}
      {rows && rows.length > 0 && total && (
        <div className="table-scroll">
          <table className="pay-table stats-table">
            <thead>
              <tr>
                <th scope="col">{tr('Период')}</th><th scope="col" className="num">{tr('Переходы')}</th><th scope="col" className="num">{tr('Регистрации')}</th><th scope="col" className="num">{tr('Оплаты')}</th>
                <th scope="col" title={tr('Сколько оплат на 1 / 3 / 6 / 12 месяцев')}>{tr('Сроки')}</th>
                {showRevenue && <th scope="col" className="num">{tr('Выручка, ₽')}</th>}
                <th scope="col" className="num">{showRevenue ? tr('Начисления, ₽') : tr('Заработано, ₽')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const zero = !row.visits && !row.registrations && !row.payments && !row.earnings
                return <tr key={row.period} className={zero ? 'is-zero' : undefined}><th scope="row">{formatPeriodKey(row.period, english)}</th>{cells(row)}</tr>
              })}
            </tbody>
            <tfoot>
              <tr><th scope="row">{tr('Итого')}</th>{cells(total)}</tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
