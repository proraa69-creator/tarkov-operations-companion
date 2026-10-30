import { BadgeCheck, ChevronLeft, ChevronRight, LoaderCircle, MousePointerClick, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, errorMessage, type ReferralSeriesRow } from '../api'
import { localeTag, tr } from '../i18n'
import { Notice } from './Notice'
import { formatRub } from './ReferralStatsTable'
import '../admin-calendar.css'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
/** Today's month in Moscow time (the statistics days follow it), YYYY-MM. */
const moscowToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10)
function shiftMonth(month: string, by: number) {
  const date = new Date(`${month}-15T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + by)
  return date.toISOString().slice(0, 7)
}

/**
 * The streamer's statistics by day as a month calendar (owner, 30.10.2026: «статистику стримера по дням в виде
 * календаря… у него и у меня в кабинете»): visits, registrations and payments in each day's cell, brighter for days with
 * more visits. The streamer's cabinet and the owner's view of a streamer (`showRevenue` adds what was paid).
 */
export function ReferralCalendar({ load, showRevenue = false }: { load: (month: string) => Promise<{ rows: ReferralSeriesRow[] }>; showRevenue?: boolean }) {
  const today = moscowToday()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [result, setResult] = useState<{ month: string; rows: ReferralSeriesRow[] } | null>(null)
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    load(month).then(
      (next) => { if (!cancelled) { setResult({ month, rows: next.rows }); setError(null) } },
      (reason: unknown) => { if (!cancelled) setError({ message: errorMessage(reason), offline: reason instanceof ApiError && reason.network }) },
    )
    return () => { cancelled = true }
  }, [load, month])

  const rows = result?.month === month ? result.rows : null
  const byDate = new Map((rows ?? []).map((row) => [row.period, row]))
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
  const days = Array.from({ length: daysInMonth }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
  const lead = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7
  const maxVisits = Math.max(0, ...(rows ?? []).map((row) => row.visits))
  const totals = (rows ?? []).reduce((sum, row) => ({ visits: sum.visits + row.visits, registrations: sum.registrations + row.registrations, payments: sum.payments + row.payments, revenue: sum.revenue + (row.revenue ?? 0) }), { visits: 0, registrations: 0, payments: 0, revenue: 0 })
  const monthName = new Intl.DateTimeFormat(localeTag(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-15T00:00:00Z`))
  const number = new Intl.NumberFormat(localeTag())

  return (
    <div className="admin-calendar referral-calendar">
      <div className="calendar-head">
        <button type="button" className="icon-button" aria-label={tr('Предыдущий месяц')} onClick={() => setMonth((value) => shiftMonth(value, -1))}><ChevronLeft size={18} aria-hidden="true" /></button>
        <h3 className="calendar-title">{monthName.slice(0, 1).toUpperCase() + monthName.slice(1)}</h3>
        <button type="button" className="icon-button" aria-label={tr('Следующий месяц')} disabled={month >= today.slice(0, 7)} onClick={() => setMonth((value) => shiftMonth(value, 1))}><ChevronRight size={18} aria-hidden="true" /></button>
        {month !== today.slice(0, 7) && <button type="button" className="button small ghost" onClick={() => setMonth(today.slice(0, 7))}>{tr('Сегодня')}</button>}
        {rows && (
          <div className="calendar-totals">
            <span>{tr('Переходы')} <strong className="mono">{number.format(totals.visits)}</strong></span>
            <span>{tr('Регистрации')} <strong className="mono">{number.format(totals.registrations)}</strong></span>
            <span>{tr('Оплаты')} <strong className="mono">{number.format(totals.payments)}</strong></span>
            {showRevenue && <span>{tr('Выручка')} <strong className="mono">{formatRub(totals.revenue)} ₽</strong></span>}
          </div>
        )}
      </div>
      {error && <Notice tone={error.offline ? 'offline' : 'error'}>{tr(error.message)}</Notice>}
      {!rows && !error && <div className="muted" style={{ fontSize: 14 }}><LoaderCircle className="spinner" size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />{tr('Загружаем статистику…')}</div>}
      {rows && (
        <div className="calendar-grid" role="grid" aria-label={monthName}>
          {WEEKDAYS.map((name) => <div key={name} className="calendar-weekday" role="columnheader">{tr(name)}</div>)}
          {Array.from({ length: lead }, (_, index) => <div key={`lead-${index}`} className="calendar-cell is-empty" aria-hidden="true" />)}
          {days.map((date) => {
            const row = byDate.get(date)
            const future = date > today
            const visits = row?.visits ?? 0, registrations = row?.registrations ?? 0, payments = row?.payments ?? 0
            const quiet = !visits && !registrations && !payments
            const label = `${Number(date.slice(8))}: ${tr('Переходы')} ${visits}, ${tr('Регистрации')} ${registrations}, ${tr('Оплаты')} ${payments}`
            return (
              <div key={date} role="gridcell" aria-label={label}
                className={`calendar-cell${date === today ? ' is-today' : ''}${future ? ' is-future' : ''}${quiet ? ' is-quiet' : ''}`}
                style={{ ['--heat' as string]: (maxVisits ? visits / maxVisits : 0).toFixed(3) }}>
                <span className="calendar-day">{Number(date.slice(8))}</span>
                {!future && (
                  <span className="calendar-meta referral-calendar-meta">
                    <span title={tr('Переходы')}><MousePointerClick aria-hidden="true" />{number.format(visits)}</span>
                    <span title={tr('Регистрации')}><UserPlus aria-hidden="true" />{number.format(registrations)}</span>
                    <span title={tr('Оплаты')}><BadgeCheck aria-hidden="true" />{number.format(payments)}</span>
                    {showRevenue && (row?.revenue ?? 0) > 0 && <span title={tr('Выручка')}>{formatRub(row!.revenue!)} ₽</span>}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
      <p className="field-hint" style={{ margin: 0 }}>{tr('Время — московское. В каждом дне: переходы по ссылке, регистрации и оплаты.')}</p>
    </div>
  )
}
