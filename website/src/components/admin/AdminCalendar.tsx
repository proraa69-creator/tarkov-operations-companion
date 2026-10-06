import { ChevronLeft, ChevronRight, Gift, LoaderCircle, UserPlus, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, type AdminCalendarDay, type AdminDay } from '../../api'
import { useAuth } from '../../auth'
import { Notice } from '../Notice'
import { Loading } from './adminShared'
import { failure, formatRub, numberFormat, PAYMENT_STATUS, PLAN_IDS, PLAN_LABEL, useAdminData, type Failure } from './adminData'
import '../../admin-calendar.css'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const monthTitle = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayTitle = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const timeOnly = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
const PROVIDER: Record<string, string> = { yookassa: 'ЮKassa', lava: 'Lava.top' }
const INVITE_STATUS: Record<string, string> = { pending: 'на проверке', review: 'у администрации', granted: 'начислено', canceled: 'не засчитано' }
const RANK: Record<string, string> = { friend: 'за друга', operator: 'ранг Operator', 'squad-leader': 'ранг Squad Leader', 'raid-commander': 'ранг Raid Commander', legend: 'ранг Legend' }

/** Today's month in Moscow time, YYYY-MM. */
const currentMonth = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 7)
function shiftMonth(month: string, by: number) {
  const date = new Date(`${month}-15T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + by)
  return date.toISOString().slice(0, 7)
}
function shiftDay(date: string, by: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10)
}
const rub = (value: number) => `${formatRub(value)} ₽`
const capitalize = (text: string) => text.slice(0, 1).toUpperCase() + text.slice(1)

/** «Календарь» of «Сводка»: a month of days; a click opens the day with everything that happened. */
export function AdminCalendar() {
  const [month, setMonth] = useState(currentMonth)
  const [open, setOpen] = useState<string | null>(null)
  const [fallbackToday] = useState(() => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10))
  const calendar = useAdminData(useCallback((token: string) => api.adminCalendar(token, month), [month]))
  const data = calendar.data?.month === month ? calendar.data : null
  const today = data?.today ?? fallbackToday
  const maxRevenue = Math.max(0, ...(data?.days.map((day) => day.revenue) ?? []))
  const totals = data?.days.reduce((sum, day) => ({ registrations: sum.registrations + day.registrations, payments: sum.payments + day.payments, revenue: sum.revenue + day.revenue }), { registrations: 0, payments: 0, revenue: 0 })
  // Monday-first grid: empty cells before the 1st.
  const lead = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7

  return (
    <div className="admin-calendar">
      <div className="calendar-head">
        <button type="button" className="icon-button" aria-label="Предыдущий месяц" onClick={() => setMonth((value) => shiftMonth(value, -1))}><ChevronLeft size={18} aria-hidden="true" /></button>
        <h3 className="calendar-title">{capitalize(monthTitle.format(new Date(`${month}-15T00:00:00Z`)))}</h3>
        <button type="button" className="icon-button" aria-label="Следующий месяц" disabled={month >= today.slice(0, 7)} onClick={() => setMonth((value) => shiftMonth(value, 1))}><ChevronRight size={18} aria-hidden="true" /></button>
        {month !== today.slice(0, 7) && <button type="button" className="button small ghost" onClick={() => setMonth(currentMonth())}>Сегодня</button>}
        {totals && (
          <div className="calendar-totals">
            <span>Выручка <strong className="mono">{rub(totals.revenue)}</strong></span>
            <span>Оплат <strong className="mono">{numberFormat.format(totals.payments)}</strong></span>
            <span>Регистраций <strong className="mono">{numberFormat.format(totals.registrations)}</strong></span>
          </div>
        )}
      </div>
      {calendar.error && <Notice tone={calendar.error.offline ? 'offline' : 'error'}>{calendar.error.message}</Notice>}
      {!data && !calendar.error && <Loading text="Загружаем календарь…" />}
      {data && (
        <div className="calendar-grid" role="grid" aria-label={`Календарь: ${monthTitle.format(new Date(`${month}-15T00:00:00Z`))}`}>
          {WEEKDAYS.map((name) => <div key={name} className="calendar-weekday" role="columnheader">{name}</div>)}
          {Array.from({ length: lead }, (_, index) => <div key={`lead-${index}`} className="calendar-cell is-empty" aria-hidden="true" />)}
          {data.days.map((day) => (
            <DayCell key={day.date} day={day} today={today} heat={maxRevenue ? day.revenue / maxRevenue : 0} onOpen={() => setOpen(day.date)} />
          ))}
        </div>
      )}
      <p className="field-hint" style={{ margin: 0 }}>Время — московское. Нажмите на день, чтобы открыть регистрации, оплаты и выданные дни.</p>
      {open && <DayDialog date={open} today={today} onChange={setOpen} onClose={() => setOpen(null)} />}
    </div>
  )
}

function DayCell({ day, today, heat, onOpen }: { day: AdminCalendarDay; today: string; heat: number; onOpen: () => void }) {
  const future = day.date > today
  const quiet = !day.registrations && !day.payments
  const label = `${Number(day.date.slice(8))} число: выручка ${rub(day.revenue)}, оплат ${day.payments}, регистраций ${day.registrations}`
  return (
    <button
      type="button"
      role="gridcell"
      className={`calendar-cell${day.date === today ? ' is-today' : ''}${future ? ' is-future' : ''}${quiet ? ' is-quiet' : ''}`}
      style={{ ['--heat' as string]: heat.toFixed(3) }}
      disabled={future}
      aria-label={label}
      onClick={onOpen}
    >
      <span className="calendar-day">{Number(day.date.slice(8))}</span>
      {!future && (
        <>
          <span className="calendar-revenue mono">{day.revenue ? rub(day.revenue) : '—'}</span>
          <span className="calendar-meta">
            {day.payments > 0 && <span title="Оплат">₽ {numberFormat.format(day.payments)}</span>}
            {day.registrations > 0 && <span title="Регистраций"><UserPlus aria-hidden="true" />{numberFormat.format(day.registrations)}</span>}
          </span>
        </>
      )}
    </button>
  )
}

function DayDialog({ date, today, onChange, onClose }: { date: string; today: string; onChange: (date: string) => void; onClose: () => void }) {
  const titleId = useId()
  const { token } = useAuth()
  // The answer for one date; another date shows the spinner until its own answer arrives.
  const [result, setResult] = useState<{ date: string; day?: AdminDay; error?: Failure } | null>(null)
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!token) return
    let alive = true
    api.adminDay(token, date).then(
      (day) => { if (alive) setResult({ date, day }) },
      (reason: unknown) => { if (alive) setResult({ date, error: failure(reason) }) },
    )
    return () => { alive = false }
  }, [token, date])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') onChange(shiftDay(date, -1))
      if (event.key === 'ArrowRight' && date < today) onChange(shiftDay(date, 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [date, today, onChange, onClose])
  useEffect(() => { dialog.current?.focus() }, [])

  const day = result?.date === date ? result.day ?? null : null
  const error = result?.date === date ? result.error ?? null : null
  return createPortal(
    <div className="pay-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="pay-dialog day-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog} tabIndex={-1}>
        <div className="pay-dialog-head">
          <div>
            <div className="eyebrow">Сводка за день</div>
            <h2 id={titleId}>{capitalize(dayTitle.format(new Date(`${date}T00:00:00Z`)))}</h2>
          </div>
          <div className="day-dialog-nav">
            <button type="button" className="icon-button" aria-label="Предыдущий день" onClick={() => onChange(shiftDay(date, -1))}><ChevronLeft size={18} aria-hidden="true" /></button>
            <button type="button" className="icon-button" aria-label="Следующий день" disabled={date >= today} onClick={() => onChange(shiftDay(date, 1))}><ChevronRight size={18} aria-hidden="true" /></button>
            <button type="button" className="icon-button" aria-label="Закрыть" onClick={onClose}><X size={18} aria-hidden="true" /></button>
          </div>
        </div>
        {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
        {!day && !error && <div className="day-dialog-loading"><LoaderCircle className="spinner" aria-hidden="true" />Загружаем день…</div>}
        {day && <DayDetails day={day} />}
      </div>
    </div>,
    document.body,
  )
}

function DayDetails({ day }: { day: AdminDay }) {
  const { totals } = day
  const plans = PLAN_IDS.filter((id) => totals.plans[id].count > 0)
  return (
    <div className="day-details">
      <dl className="day-stats">
        <div><dt>Выручка</dt><dd className="mono accent">{rub(totals.revenue)}</dd></div>
        <div><dt>Оплат</dt><dd className="mono">{numberFormat.format(totals.payments)}</dd></div>
        <div><dt>Регистраций</dt><dd className="mono">{numberFormat.format(totals.registrations)}</dd></div>
        <div><dt>Доля стримеров</dt><dd className="mono">{rub(totals.streamerEarnings)}</dd></div>
      </dl>
      {(totals.yookassa > 0 || totals.lava > 0 || plans.length > 0) && (
        <p className="day-split">
          {totals.yookassa > 0 && <span>ЮKassa <strong className="mono">{rub(totals.yookassa)}</strong></span>}
          {totals.lava > 0 && <span>Lava.top <strong className="mono">{rub(totals.lava)}</strong></span>}
          {plans.map((id) => <span key={id}>{PLAN_LABEL[id]}: <strong className="mono">{numberFormat.format(totals.plans[id].count)}</strong> · {rub(totals.plans[id].revenue)}</span>)}
        </p>
      )}

      <section aria-label="Оплаты">
        <h3 className="day-section-title">Оплаты <span className="mono">{day.payments.length}</span></h3>
        {day.payments.length === 0 ? <p className="day-empty">Оплат не было.</p> : (
          <div className="table-scroll">
            <table className="pay-table admin-table day-table">
              <thead><tr><th scope="col">Время</th><th scope="col">E-mail</th><th scope="col">Тариф</th><th scope="col">Способ</th><th scope="col">Статус</th><th scope="col" className="num">Сумма</th></tr></thead>
              <tbody>
                {day.payments.map((payment) => {
                  const status = PAYMENT_STATUS[payment.status] ?? { label: payment.status, tone: '' }
                  return (
                    <tr key={payment.id}>
                      <td className="mono">{timeOnly.format(new Date(payment.paidAt ?? payment.createdAt))}</td>
                      <td className="day-email">{payment.email}{payment.referralCode && <span className="tag">{payment.referralCode}</span>}</td>
                      <td>{PLAN_LABEL[payment.plan]}{payment.renewal && ' · продление'}</td>
                      <td>{PROVIDER[payment.provider] ?? payment.provider}</td>
                      <td><span className={`tag ${status.tone}`}>{status.label}</span></td>
                      <td className="num mono">{rub(payment.amount)}{payment.original && <span className="day-original"> · {formatRub(payment.original.amount)} {payment.original.currency}</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="Регистрации">
        <h3 className="day-section-title">Регистрации <span className="mono">{totals.registrations}</span></h3>
        {day.registrations.length === 0 ? <p className="day-empty">Новых аккаунтов не было.</p> : (
          <ul className="day-list">
            {day.registrations.map((item) => (
              <li key={item.id}>
                <span className="mono">{timeOnly.format(new Date(item.createdAt))}</span>
                <span className="day-email">{item.email}</span>
                {item.kind === 'streamer' && <span className="tag">стример</span>}
                {item.referredBy && <span className="tag" title="Код стримера">{item.referredBy}</span>}
                {item.invitedByFriend && <span className="tag green">по коду друга</span>}
              </li>
            ))}
          </ul>
        )}
        {totals.registrations > day.registrations.length && <p className="day-empty">Показаны первые {day.registrations.length}.</p>}
      </section>

      {day.grants.length > 0 && (
        <section aria-label="Выданные дни">
          <h3 className="day-section-title">Выданные дни <span className="mono">{day.grants.length}</span></h3>
          <ul className="day-list">
            {day.grants.map((grant, index) => (
              <li key={index}>
                <span className="mono">{timeOnly.format(new Date(grant.at))}</span>
                <span className="day-email">{grant.email}</span>
                <span className="tag green">+{grant.days} дн.</span>
                <span className="day-note">{grant.reason} · {grant.actor}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {day.invites.length > 0 && (
        <section aria-label="Награды за друзей">
          <h3 className="day-section-title"><Gift aria-hidden="true" />Награды за друзей <span className="mono">{day.invites.length}</span></h3>
          <ul className="day-list">
            {day.invites.map((invite, index) => (
              <li key={index}>
                <span className="mono">{timeOnly.format(new Date(invite.decidedAt ?? invite.createdAt))}</span>
                <span className="day-email">{invite.inviter}</span>
                <span className="tag">{invite.days === 'lifetime' ? 'навсегда' : `+${invite.days} дн.`}</span>
                <span className="day-note">{RANK[invite.kind] ?? invite.kind} · {INVITE_STATUS[invite.status] ?? invite.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
