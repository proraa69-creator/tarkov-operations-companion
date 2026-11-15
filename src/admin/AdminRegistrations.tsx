import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, CreditCard, Gift, LineChart, UserPlus, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { ownerDay } from '../shared/ownerTime'
import { LONG_PRESS_MS, pickDay, pickedDayState, pickedRange, pickedRangeText, type PickedDays } from '../shared/adminPeriod'
import { adminApi, adminPaths, type AdminCalendar, type AdminCalendarDay, type AdminDay, type AdminRangeStats } from './adminApi'
import { accountText, count, errorText, money, PLAN_IDS, PLAN_SHORT, timeOnly } from './adminFormat'
import { AdminEmpty, AdminLoading, PaymentRow } from './adminShared'
import { useAdminAnswer } from './useAdminAnswer'

/**
 * «Регистрации и оплаты» of «Сводка», as on the site (owner, 03.11.2026: «календарь регистраций и оплат, месяц за
 * месяцем стрелочками, каждый день со своими цифрами»): the calendar of a month, a day's window, 12 months, the years.
 * Days are the owner's (Bangkok).
 */
type View = 'calendar' | 'month' | 'year'
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'calendar', label: 'Календарь' },
  { id: 'month', label: '12 месяцев' },
  { id: 'year', label: 'По годам' },
]
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const monthTitle = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayTitle = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const capitalize = (text: string) => text.slice(0, 1).toUpperCase() + text.slice(1)
/** Today's month in the owner's time, YYYY-MM. */
const currentMonth = () => ownerDay(Date.now()).slice(0, 7)

function shiftMonth(month: string, by: number) {
  const date = new Date(`${month}-15T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + by)
  return date.toISOString().slice(0, 7)
}
function shiftDay(date: string, by: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10)
}
/** A day's revenue in a calendar cell: 600 → «600», 1 800 → «1,8к», 12 500 → «13к». */
function compactRub(value: number) {
  if (value < 1000) return String(Math.round(value))
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0).replace('.', ',').replace(/,0$/, '')}к`
}
/** 2026-11 → «Ноябрь 2026», 2026 → «2026». */
const periodTitle = (period: string) => period.length === 7 ? capitalize(monthTitle.format(new Date(`${period}-15T00:00:00Z`))) : period

export function RegistrationsBlock({ refreshKey }: { refreshKey: number }) {
  const [view, setView] = useState<View>('calendar')
  return <section className="admin-block admin-registrations" aria-label={uiText('Регистрации и оплаты')}>
    <div className="admin-block-heading"><CalendarDays size={15} /><span>{uiText('Регистрации и оплаты')}</span></div>
    <div className="admin-chip-row" role="group" aria-label={uiText('Вид статистики')}>
      {VIEWS.map((item) => <button type="button" key={item.id} className={view === item.id ? 'active' : ''} aria-pressed={view === item.id} onClick={() => setView(item.id)}>{uiText(item.label)}</button>)}
    </div>
    {view === 'calendar' ? <CalendarView refreshKey={refreshKey} /> : <SeriesView period={view} refreshKey={refreshKey} />}
  </section>
}

/**
 * A long press on a day picks the first and then the second day of a period (owner, 15.11.2026: «долгое нажатие… можно
 * листать месяцы»), a third one or the cross drops them; «Сводка за период» shows above the month.
 */
function CalendarView({ refreshKey }: { refreshKey: number }) {
  const [month, setMonth] = useState(currentMonth)
  const [open, setOpen] = useState<string | null>(null)
  const [picked, setPicked] = useState<PickedDays>({})
  const range = pickedRange(picked)
  const [fallbackToday] = useState(() => ownerDay(Date.now()))
  // The month kept from the last time at once, then the fresh one; another month's answer is never drawn under this title.
  const loadCalendar = useCallback(() => adminApi.calendar(month), [month])
  const calendar = useAdminAnswer<AdminCalendar>(adminPaths.calendar(month), loadCalendar, refreshKey)
  const data = calendar.data
  const error = data ? '' : calendar.error
  const today = data?.today ?? fallbackToday
  const maxRevenue = Math.max(0, ...(data?.days.map((day) => day.revenue) ?? []))
  const totals = data?.days.reduce((sum, day) => ({ registrations: sum.registrations + day.registrations, payments: sum.payments + day.payments, revenue: sum.revenue + day.revenue }), { registrations: 0, payments: 0, revenue: 0 })
  // Monday-first grid: empty cells before the 1st.
  const lead = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7
  const title = capitalize(monthTitle.format(new Date(`${month}-15T00:00:00Z`)))

  return <div className="admin-calendar">
    <div className="admin-calendar-head">
      <button type="button" className="icon-button" aria-label={uiText('Предыдущий месяц')} onClick={() => setMonth((value) => shiftMonth(value, -1))}><ChevronLeft size={18} /></button>
      <strong>{uiText(title)}</strong>
      <button type="button" className="icon-button" aria-label={uiText('Следующий месяц')} disabled={month >= today.slice(0, 7)} onClick={() => setMonth((value) => shiftMonth(value, 1))}><ChevronRight size={18} /></button>
    </div>
    {month !== today.slice(0, 7) && <button type="button" className="button small ghost admin-calendar-today" onClick={() => setMonth(currentMonth())}>{uiText('К текущему месяцу')}</button>}
    {totals && <div className="admin-calendar-totals">
      <span>{uiText('Выручка')}<strong>{money(totals.revenue)}</strong></span>
      <span>{uiText('Оплат')}<strong>{count.format(totals.payments)}</strong></span>
      <span>{uiText('Регистраций')}<strong>{count.format(totals.registrations)}</strong></span>
    </div>}
    {range && <PeriodSummary from={range.from} to={range.to} refreshKey={refreshKey} onClear={() => setPicked({})} />}
    {picked.first && !range && <div className="admin-period-wait"><span>{uiText('Долгое нажатие — второй день')}</span><button type="button" className="icon-button" aria-label={uiText('Снять выбор')} onClick={() => setPicked({})}><X size={16} /></button></div>}
    {error && <div className="admin-inline-error" role="alert">{uiText(error)}</div>}
    {!data && !error && <AdminLoading />}
    {data && <div className="admin-calendar-grid" role="grid" aria-label={uiText(`Календарь: ${title}`)}>
      {WEEKDAYS.map((name) => <span key={name} className="admin-calendar-weekday" role="columnheader">{uiText(name)}</span>)}
      {Array.from({ length: lead }, (_, index) => <span key={`lead-${index}`} className="admin-calendar-cell is-empty" aria-hidden="true" />)}
      {data.days.map((day) => <DayCell key={day.date} day={day} today={today} heat={maxRevenue ? day.revenue / maxRevenue : 0} picked={pickedDayState(picked, day.date)} onOpen={() => setOpen(day.date)} onPick={() => setPicked((value) => pickDay(value, day.date))} />)}
    </div>}
    <p className="admin-calendar-note">{uiText('Время — по Бангкоку (UTC+7). Нажмите на день, чтобы открыть регистрации, оплаты и выданные дни. Долгое нажатие — начало и конец периода.')}</p>
    {open && <DaySheet date={open} today={today} onChange={setOpen} onClose={() => setOpen(null)} />}
  </div>
}

/**
 * «Сводка за период» (owner, 15.11.2026), as on the site: revenue with the payments and the repeat ones, registrations,
 * who paid (first time / again), the free periods of the accounts registered then (dead / real) and the plans.
 */
function PeriodSummary({ from, to, refreshKey, onClear }: { from: string; to: string; refreshKey: number; onClear: () => void }) {
  const load = useCallback(() => adminApi.rangeStats(from, to), [from, to])
  const stats = useAdminAnswer<AdminRangeStats>(adminPaths.rangeStats(from, to), load, refreshKey)
  const data = stats.data?.range.from === from && stats.data.range.to === to ? stats.data : null
  const { revenue, payers, trialConversion: trials } = data ?? {}
  const plans = revenue ? PLAN_IDS.filter((id) => (revenue.byPlan[id]?.count ?? 0) > 0) : []
  return <section className="admin-period" aria-label={uiText(`Сводка за период ${pickedRangeText(from, to)}`)}>
    <div className="admin-period-head">
      <span><strong>{uiText('Сводка за период')}</strong><small>{pickedRangeText(from, to)}</small></span>
      <button type="button" className="icon-button" aria-label={uiText('Снять выбор')} onClick={onClear}><X size={16} /></button>
    </div>
    {!data && (stats.error ? <div className="admin-inline-error" role="alert">{uiText(stats.error)}</div> : <AdminLoading />)}
    {data && revenue && payers && trials && <>
      <div className="admin-period-cards">
        <article className="is-money"><span><LineChart size={14} />{uiText('Выручка')}</span><strong>{money(revenue.total)}</strong><small>{uiText(`оплат: ${count.format(revenue.payments)}${revenue.repeatPayments === undefined ? '' : ` · повторных: ${count.format(revenue.repeatPayments)}`}`)}</small></article>
        <article><span><UserPlus size={14} />{uiText('Регистрации')}</span><strong>{count.format(data.users.new)}</strong><small>{uiText('новых аккаунтов')}</small></article>
        <article><span><CreditCard size={14} />{uiText('Платные подписки')}</span><strong>{count.format(payers.paidInRange)}</strong><small>{uiText(`впервые ${count.format(payers.newInRange)} · повторно ${count.format(payers.repeatInRange)}`)}</small></article>
        <article><span><Gift size={14} />{uiText('Пробный период')}</span><strong>{count.format(trials.trialStarted)}</strong><small>{uiText(`${trials.dead !== undefined && trials.alive !== undefined ? `мёртвых ${count.format(trials.dead)} · реальных ${count.format(trials.alive)} · ` : ''}оплатили ${count.format(trials.laterPaid)}`)}</small></article>
      </div>
      {plans.length > 0 && <p className="admin-day-split">{plans.map((id) => <span key={id}>{uiText(PLAN_SHORT[id])}: <strong>{revenue.byPlan[id]!.count}</strong> · {money(revenue.byPlan[id]!.amount)}</span>)}</p>}
      {revenue.refunds.count > 0 && <small className="admin-day-more">{uiText(`возвратов: ${count.format(revenue.refunds.count)} · ${money(revenue.refunds.amount)}`)}</small>}
    </>}
  </section>
}

function DayCell({ day, today, heat, picked, onOpen, onPick }: { day: AdminCalendarDay; today: string; heat: number; picked?: ReturnType<typeof pickedDayState>; onOpen: () => void; onPick: () => void }) {
  const future = day.date > today
  const number = Number(day.date.slice(8))
  // A finger held LONG_PRESS_MS picks the day; the tap that ends it does not open the day. Android also sends a
  // contextmenu for a long press (a right click elsewhere): one pick for both.
  const press = useRef<{ timer?: number; fired: boolean; x: number; y: number }>({ fired: false, x: 0, y: 0 })
  const stop = () => { window.clearTimeout(press.current.timer); press.current.timer = undefined }
  const pick = () => {
    stop()
    if (press.current.fired) return
    press.current.fired = true
    navigator.vibrate?.(15)
    onPick()
  }
  useEffect(() => stop, [])
  return <button
    type="button"
    role="gridcell"
    className={`admin-calendar-cell${day.date === today ? ' is-today' : ''}${future ? ' is-future' : ''}${!day.registrations && !day.payments ? ' is-quiet' : ''}${picked ? ` is-picked is-picked-${picked}` : ''}`}
    style={{ ['--heat' as string]: heat.toFixed(3) }}
    disabled={future}
    aria-pressed={picked ? true : undefined}
    aria-label={uiText(`${number} число: выручка ${money(day.revenue)}, оплат ${day.payments}, регистраций ${day.registrations}`)}
    onTouchStart={(event) => { stop(); Object.assign(press.current, { fired: false, x: event.touches[0]?.clientX ?? 0, y: event.touches[0]?.clientY ?? 0 }); press.current.timer = window.setTimeout(pick, LONG_PRESS_MS) }}
    // A trembling finger stays a press; a scroll (10 px and more) is not one.
    onTouchMove={(event) => { const touch = event.touches[0]; if (!touch || Math.hypot(touch.clientX - press.current.x, touch.clientY - press.current.y) >= 10) stop() }}
    onTouchEnd={stop}
    onTouchCancel={stop}
    onContextMenu={(event) => { event.preventDefault(); if (future) return; if (press.current.timer === undefined && !press.current.fired) { pick(); press.current.fired = false } else pick() }}
    onClick={() => { if (press.current.fired) { press.current.fired = false; return } onOpen() }}
  >
    <span className="admin-calendar-day">{number}</span>
    {!future && <>
      <span className="admin-calendar-revenue">{day.revenue ? compactRub(day.revenue) : ''}</span>
      <span className="admin-calendar-meta">
        {day.payments > 0 && <span className="is-pay"><CreditCard size={9} aria-hidden="true" />{day.payments}</span>}
        {day.registrations > 0 && <span className="is-reg"><UserPlus size={9} aria-hidden="true" />{day.registrations}</span>}
      </span>
    </>}
  </button>
}

function DaySheet({ date, today, onChange, onClose }: { date: string; today: string; onChange: (date: string) => void; onClose: () => void }) {
  // The answer for one date; another date shows the spinner until its own answer arrives.
  const [result, setResult] = useState<{ date: string; day?: AdminDay; error?: string } | null>(null)
  useEffect(() => {
    let active = true
    adminApi.day(date).then(
      (day) => { if (active) setResult({ date, day }) },
      (reason: unknown) => { if (active) setResult({ date, error: errorText(reason) }) },
    )
    return () => { active = false }
  }, [date])
  const day = result?.date === date ? result.day ?? null : null
  const error = result?.date === date ? result.error ?? '' : ''
  const title = capitalize(dayTitle.format(new Date(`${date}T00:00:00Z`)))
  return <div className="admin-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="panel admin-user-sheet" role="dialog" aria-modal="true" aria-label={uiText(title)}>
      <header className="admin-sheet-head">
        <button type="button" className="icon-button" onClick={() => onChange(shiftDay(date, -1))} aria-label={uiText('Предыдущий день')}><ChevronLeft size={18} /></button>
        <div><strong>{uiText(title)}</strong><small>{uiText('Сводка за день')}</small></div>
        <div className="admin-sheet-actions">
          <button type="button" className="icon-button" disabled={date >= today} onClick={() => onChange(shiftDay(date, 1))} aria-label={uiText('Следующий день')}><ChevronRight size={18} /></button>
          <button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        </div>
      </header>
      <div className="admin-sheet-scroll">
        {error && <div className="admin-inline-error" role="alert">{uiText(error)}</div>}
        {!day && !error && <AdminLoading />}
        {day && <DayDetails day={day} />}
      </div>
    </section>
  </div>
}

const REWARD_KIND: Record<string, string> = { friend: 'за друга', scout: 'ранг Scout', operator: 'ранг Operator', 'squad-leader': 'ранг Squad Leader', 'raid-commander': 'ранг Raid Commander', legend: 'ранг Legend' }
const REWARD_STATUS: Record<string, string> = { pending: 'на проверке', review: 'у администрации', granted: 'начислено', canceled: 'не засчитано' }

function registrationOrigin(item: AdminDay['registrations'][number]) {
  if (item.invitedBy) return `по приглашению от ${accountText(item.invitedBy.deleted ? undefined : item.invitedBy.email, item.invitedBy.nickname)}`
  if (item.invitedByFriend) return 'по коду друга'
  return item.referredBy ? `по коду стримера ${item.referredBy}` : 'без приглашения'
}

function DayDetails({ day }: { day: AdminDay }) {
  const { totals } = day
  const plans = PLAN_IDS.filter((id) => (totals.plans[id]?.count ?? 0) > 0)
  return <>
    <div className="admin-user-facts admin-facts-two">
      <article><span>{uiText('Выручка')}</span><strong>{money(totals.revenue)}</strong></article>
      <article><span>{uiText('Оплат')}</span><strong>{count.format(totals.payments)}</strong></article>
      <article><span>{uiText('Регистраций')}</span><strong>{count.format(totals.registrations)}</strong></article>
      <article><span>{uiText('Доля стримеров')}</span><strong>{money(totals.streamerEarnings)}</strong></article>
    </div>
    {plans.length > 0 && <p className="admin-day-split">{plans.map((id) => <span key={id}>{uiText(PLAN_SHORT[id])}: <strong>{totals.plans[id].count}</strong> · {money(totals.plans[id].revenue)}</span>)}</p>}
    <div className="admin-history">
      <h2>{uiText(`Оплаты · ${day.payments.length}`)}</h2>
      {day.payments.map((payment) => <PaymentRow key={payment.id} payment={payment} />)}
      {!day.payments.length && <AdminEmpty text="Оплат не было" />}
      <h2>{uiText(`Регистрации · ${totals.registrations}`)}</h2>
      {day.registrations.map((item) => <article className="admin-grant-row" key={item.id}>
        <span><strong>{item.email}</strong><small>{uiText(registrationOrigin(item))}</small></span>
        <span><strong>{timeOnly(item.createdAt)}</strong>{item.kind === 'streamer' && <small>{uiText('стример')}</small>}</span>
      </article>)}
      {!day.registrations.length && <AdminEmpty text="Новых аккаунтов не было" />}
      {totals.registrations > day.registrations.length && <small className="admin-day-more">{uiText(`Показаны первые ${day.registrations.length}`)}</small>}
      {day.grants.length > 0 && <>
        <h2>{uiText(`Выданные дни · ${day.grants.length}`)}</h2>
        {day.grants.map((grant, index) => <article className="admin-grant-row" key={`${grant.at}-${index}`}>
          <span><strong>{grant.email}</strong><small>{grant.reason} · {grant.actor}</small></span>
          <span><strong>{uiText(`+${grant.days} дн.`)}</strong><small>{timeOnly(grant.at)}</small></span>
        </article>)}
      </>}
      {day.invites.length > 0 && <>
        <h2>{uiText(`Награды за друзей · ${day.invites.length}`)}</h2>
        {day.invites.map((invite, index) => <article className="admin-grant-row" key={`${invite.createdAt}-${index}`}>
          <span>
            <strong>{accountText(invite.inviter, invite.inviterNickname)}</strong>
            {invite.kind === 'friend' && (invite.friend || invite.friendDeleted) && <small>{uiText(`друг: ${accountText(invite.friendDeleted ? undefined : invite.friend, invite.friendNickname)}`)}</small>}
            <small>{uiText(`${REWARD_KIND[invite.kind] ?? invite.kind} · ${REWARD_STATUS[invite.status] ?? invite.status}`)}</small>
          </span>
          <span><strong>{uiText(invite.days === 'lifetime' ? 'навсегда' : `+${invite.days} дн.`)}</strong><small>{timeOnly(invite.decidedAt ?? invite.createdAt)}</small></span>
        </article>)}
      </>}
    </div>
  </>
}

function SeriesView({ period, refreshKey }: { period: 'month' | 'year'; refreshKey: number }) {
  const loadSeries = useCallback(() => adminApi.series(period), [period])
  const series = useAdminAnswer(adminPaths.series(period), loadSeries, refreshKey)
  const rows = series.data?.rows ?? null
  const error = rows ? '' : series.error
  const total = rows?.reduce((sum, row) => ({ registrations: sum.registrations + row.registrations, payments: sum.payments + row.payments, revenue: sum.revenue + row.revenue }), { registrations: 0, payments: 0, revenue: 0 })
  return <div className="admin-series">
    {error && <div className="admin-inline-error" role="alert">{uiText(error)}</div>}
    {!rows && !error && <AdminLoading />}
    {rows && !rows.length && <AdminEmpty text="Данных пока нет" />}
    {rows && rows.length > 0 && total && <div className="admin-series-table" role="table" aria-label={uiText(period === 'month' ? '12 месяцев' : 'По годам')}>
      <div className="admin-series-row header" role="row"><span role="columnheader">{uiText('Период')}</span><span role="columnheader">{uiText('Рег.')}</span><span role="columnheader">{uiText('Оплат')}</span><span role="columnheader">{uiText('Выручка')}</span></div>
      {rows.map((row) => {
        const plans = PLAN_IDS.filter((id) => (row.plans[id]?.count ?? 0) > 0).map((id) => `${PLAN_SHORT[id]} ${row.plans[id].count}`).join(' · ')
        return <div className={`admin-series-row${!row.registrations && !row.payments ? ' is-zero' : ''}`} role="row" key={row.period}>
          <span role="rowheader">{uiText(periodTitle(row.period))}{plans && <small>{uiText(plans)}</small>}</span>
          <strong role="cell">{count.format(row.registrations)}</strong>
          <strong role="cell">{count.format(row.payments)}</strong>
          <strong role="cell" className="is-money">{money(row.revenue)}</strong>
        </div>
      })}
      <div className="admin-series-row total" role="row">
        <span role="rowheader">{uiText('Итого')}</span>
        <strong role="cell">{count.format(total.registrations)}</strong>
        <strong role="cell">{count.format(total.payments)}</strong>
        <strong role="cell" className="is-money">{money(total.revenue)}</strong>
      </div>
    </div>}
  </div>
}
