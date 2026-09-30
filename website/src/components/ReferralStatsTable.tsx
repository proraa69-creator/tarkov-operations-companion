import { LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, errorMessage, type PlanId, type ReferralSeriesRow, type StatsPeriod } from '../api'
import { Notice } from './Notice'

const STATS_PERIODS: { id: StatsPeriod; label: string }[] = [
  { id: 'day', label: 'По дням' },
  { id: 'month', label: 'По месяцам' },
  { id: 'year', label: 'По годам' },
]
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const MONTHS_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const PLAN_IDS: PlanId[] = ['1m', '3m', '6m', '12m']
const numberFormat = new Intl.NumberFormat('ru-RU')
const rubFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const rubCentsFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Whole roubles without kopecks, otherwise always two digits (119,60). */
export const formatRub = (amount: number) => {
  const rounded = Math.round(amount * 100) / 100
  return (Number.isInteger(rounded) ? rubFormat : rubCentsFormat).format(rounded)
}

/** 2026-10-01 → «1 окт 2026», 2026-10 → «Октябрь 2026», 2026 → «2026». */
export function formatPeriodKey(key: string) {
  const [year, month, day] = key.split('-')
  const m = Number(month) - 1
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
  const total = rows?.reduce<ReferralSeriesRow>((sum, row) => ({
    period: '', visits: sum.visits + row.visits, registrations: sum.registrations + row.registrations, payments: sum.payments + row.payments,
    months: { '1m': sum.months['1m'] + row.months['1m'], '3m': sum.months['3m'] + row.months['3m'], '6m': sum.months['6m'] + row.months['6m'], '12m': sum.months['12m'] + row.months['12m'] },
    revenue: (sum.revenue ?? 0) + (row.revenue ?? 0), earnings: sum.earnings + row.earnings,
  }), { period: '', visits: 0, registrations: 0, payments: 0, months: { '1m': 0, '3m': 0, '6m': 0, '12m': 0 }, revenue: 0, earnings: 0 })
  const cells = (row: ReferralSeriesRow) => (
    <>
      <td className="num mono">{numberFormat.format(row.visits)}</td>
      <td className="num mono">{numberFormat.format(row.registrations)}</td>
      <td className="num mono">{numberFormat.format(row.payments)}</td>
      <td className="mono terms">{PLAN_IDS.filter((id) => row.months[id]).map((id) => `${id.replace('m', 'м')}: ${numberFormat.format(row.months[id])}`).join(' · ') || '—'}</td>
      {showRevenue && <td className="num mono">{formatRub(row.revenue ?? 0)}</td>}
      <td className="num mono accent">{formatRub(row.earnings)}</td>
    </>
  )

  return (
    <div className="ref-series">
      <div className="ref-series-head">
        <div className="field-label">{title}</div>
        <div role="tablist" aria-label="Период" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATS_PERIODS.map(({ id, label }) => (
            <button key={id} type="button" role="tab" aria-selected={period === id} className={`button small ${period === id ? 'primary' : 'ghost'}`} onClick={() => setPeriod(id)}>{label}</button>
          ))}
        </div>
      </div>
      {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
      {!rows && !error && <div className="muted" style={{ fontSize: 14 }}><LoaderCircle className="spinner" size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Загружаем статистику…</div>}
      {rows && rows.length === 0 && <div className="muted" style={{ fontSize: 14 }}>Пока нет данных — они появятся после первых переходов по ссылке.</div>}
      {rows && rows.length > 0 && total && (
        <div className="table-scroll">
          <table className="pay-table stats-table">
            <thead>
              <tr>
                <th scope="col">Период</th><th scope="col" className="num">Переходы</th><th scope="col" className="num">Регистрации</th><th scope="col" className="num">Оплаты</th>
                <th scope="col" title="Сколько оплат на 1 / 3 / 6 / 12 месяцев">Сроки</th>
                {showRevenue && <th scope="col" className="num">Выручка, ₽</th>}
                <th scope="col" className="num">{showRevenue ? 'Начисления, ₽' : 'Заработано, ₽'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const zero = !row.visits && !row.registrations && !row.payments && !row.earnings
                return <tr key={row.period} className={zero ? 'is-zero' : undefined}><th scope="row">{formatPeriodKey(row.period)}</th>{cells(row)}</tr>
              })}
            </tbody>
            <tfoot>
              <tr><th scope="row">Итого</th>{cells(total)}</tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
