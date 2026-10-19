import { Activity, CreditCard, Gift, LineChart, RefreshCw, Shield, UserPlus, Users, Wifi } from 'lucide-react'
import { useCallback, useState } from 'react'
import { api, type AdminOnlineStats, type AdminOverview, type AdminRevenue, type StatsPeriod } from '../../api'
import { Notice } from '../Notice'
import { ColumnChart, Loading, PlanCounts } from './adminShared'
import { AdminCalendar } from './AdminCalendar'
import { formatPeriodKey, formatRub, numberFormat, PLAN_IDS, PLAN_LABEL, useAdminData } from './adminData'

type View = 'calendar' | Exclude<StatsPeriod, 'day'>
const PERIODS: Array<{ id: View; label: string }> = [
  { id: 'calendar', label: 'Календарь' },
  { id: 'month', label: '12 месяцев' },
  { id: 'year', label: 'По годам' },
]
/** Days of «История по дням» shown before «Показать все». */
export const ONLINE_DAYS_FOLDED = 3

const rub = (value: number) => `${formatRub(value)} ₽`
const dayLabel = (date: string) => new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))

/**
 * «Сводка»: users, really paid subscriptions, revenue, subscriptions by plan, online statistics, squads, and tables by
 * day / month / year. The streamer blocks are gone (owner, 20.10.2026: «всё, что со стримерами связано, убери… и добавь
 * статистику онлайна, как в приложении»).
 */
export function AdminSummary() {
  const overview = useAdminData(useCallback((token: string) => api.adminOverview(token), []))
  const data = overview.data
  return (
    <div className="admin-stack">
      {overview.error && <Notice tone={overview.error.offline ? 'offline' : 'error'}>{overview.error.message}</Notice>}
      {!data && !overview.error && <Loading text="Считаем сводку…" />}
      {data && (
        <>
          <div className="stat-grid admin-stats">
            <Stat icon={Users} label="Пользователи" value={numberFormat.format(data.users.total)} meta={`сегодня +${numberFormat.format(data.users.today)} · 7 дн. +${numberFormat.format(data.users.days7)}`} />
            <Stat icon={CreditCard} label="Платные подписки" value={numberFormat.format(data.subscriptions.active)} meta="только те, кто оплатил и подписка идёт" accent />
            <Stat icon={Gift} label="Пробный период" value={numberFormat.format(data.subscriptions.trials)} meta="1 день с первого входа в приложение" />
            <Stat icon={UserPlus} label="Новые за 30 дней" value={numberFormat.format(data.users.days30)} meta={data.users.blocked ? `заблокировано аккаунтов: ${numberFormat.format(data.users.blocked)}` : `за 7 дней: ${numberFormat.format(data.users.days7)}`} />
          </div>
          <div className="admin-revenue">
            <RevenueCard title="Выручка сегодня" revenue={data.revenue.today} />
            <RevenueCard title="За этот месяц" revenue={data.revenue.month} />
            <RevenueCard title="За всё время" revenue={data.revenue.all} />
          </div>
          {data.plans && (
            <section className="admin-section" aria-labelledby="admin-plans-title">
              <h2 className="field-label" id="admin-plans-title">Подписки по срокам</h2>
              <PlanCounts columns={[{ title: 'Этот месяц', plans: data.plans.month }, { title: 'За всё время', plans: data.plans.all }]} />
            </section>
          )}
          {data.squads && <SquadStats squads={data.squads} />}
          <p className="field-hint" style={{ margin: 0 }}>Время — московское. Выданные вручную дни подписки не считаются выручкой.</p>
        </>
      )}
      <OnlineStats />
      <SeriesSection />
    </div>
  )
}

/** «Отряды» (owner, 20.10.2026: «сколько создано, сколько расформировано, сколько сейчас и сколько человек в них»). */
function SquadStats({ squads }: { squads: NonNullable<AdminOverview['squads']> }) {
  const since = squads.since ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(squads.since)) : null
  return (
    <section className="admin-section" aria-labelledby="admin-squads-title">
      <h2 className="field-label" id="admin-squads-title">Отряды</h2>
      <div className="stat-grid admin-stats">
        <Stat icon={Shield} label="Сейчас отрядов" value={numberFormat.format(squads.active)} meta={`за 30 дней создано: ${numberFormat.format(squads.created30)}`} accent={squads.active > 0} />
        <Stat icon={Users} label="Играют в отрядах" value={numberFormat.format(squads.players)} meta={squads.active ? `в среднем ${(squads.players / squads.active).toFixed(1)} в отряде` : 'отрядов сейчас нет'} />
        <Stat icon={UserPlus} label="Создано всего" value={numberFormat.format(squads.created)} meta={since ? `учёт с ${since}` : 'учёт идёт с этой версии'} />
        <Stat icon={Activity} label="Расформировано" value={numberFormat.format(squads.disbanded)} meta="распущены или все вышли" />
      </div>
    </section>
  )
}

/** «Статистика онлайна» as in the phone admin app: now, today, and the days before (three, then «Показать все»). */
function OnlineStats() {
  const stats = useAdminData(useCallback((token: string) => api.adminOnlineStats(token, 30), []))
  const [all, setAll] = useState(false)
  const data: AdminOnlineStats | null = stats.data
  if (stats.error || !data) return null
  const today = data.today
  const days = all ? data.history : data.history.slice(0, ONLINE_DAYS_FOLDED)
  return (
    <section className="admin-section" aria-labelledby="admin-online-title">
      <div className="admin-section-head">
        <h2 className="field-label" id="admin-online-title"><Wifi aria-hidden="true" /> Статистика онлайна</h2>
        <button type="button" className="button small ghost" onClick={() => void stats.refresh()} disabled={stats.loading} aria-label="Обновить онлайн"><RefreshCw aria-hidden="true" className={stats.loading ? 'spinner' : undefined} /></button>
      </div>
      <div className="stat-grid admin-stats">
        <Stat icon={Wifi} label="Сейчас" value={numberFormat.format(data.current)} meta={`в приложении за последние ${data.windowMinutes} мин`} accent />
        <Stat icon={Users} label="За сегодня" value={today ? numberFormat.format(today.users) : '—'} meta="уникальных пользователей" />
        <Stat icon={Activity} label="Максимум сегодня" value={today ? numberFormat.format(today.maximum) : '—'} meta={today ? `минимум ${numberFormat.format(today.minimum)} · в среднем ${today.average}` : 'одновременно'} />
      </div>
      {data.history.length > 0 && (
        <div className="table-scroll">
          <table className="pay-table admin-table">
            <thead><tr><th scope="col">День</th><th scope="col" className="num">За день</th><th scope="col" className="num">Мин.</th><th scope="col" className="num">Сред.</th><th scope="col" className="num">Макс.</th></tr></thead>
            <tbody>
              {days.map((row) => (
                <tr key={row.date}><th scope="row">{dayLabel(row.date)}</th><td className="num mono">{numberFormat.format(row.users)}</td><td className="num mono">{row.minimum}</td><td className="num mono">{row.average}</td><td className="num mono">{row.maximum}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.history.length > ONLINE_DAYS_FOLDED && (
        <button type="button" className="button small ghost" onClick={() => setAll((value) => !value)}>{all ? 'Свернуть' : `Показать все дни (${data.history.length})`}</button>
      )}
    </section>
  )
}

function Stat({ icon: Icon, label, value, meta, accent = false }: { icon: typeof Users; label: string; value: string; meta: string; accent?: boolean }) {
  return (
    <div className={`stat-card${accent ? ' is-accent' : ''}`}>
      <div className="stat-label"><Icon aria-hidden="true" />{label}</div>
      <div className="stat-value mono">{value}</div>
      <div className="stat-meta">{meta}</div>
    </div>
  )
}

function RevenueCard({ title, revenue }: { title: string; revenue: AdminRevenue }) {
  return (
    <div className="stat-card admin-revenue-card">
      <div className="stat-label"><LineChart aria-hidden="true" />{title}</div>
      <div className="stat-value mono">{rub(revenue.total)}</div>
      <dl className="admin-split">
        <div><dt>Оплат</dt><dd className="mono">{numberFormat.format(revenue.payments)}</dd></div>
      </dl>
    </div>
  )
}

function SeriesSection() {
  const [view, setView] = useState<View>('calendar')
  // The calendar loads its own month; the tables need the series of 12 months or of the years.
  const period: StatsPeriod = view === 'calendar' ? 'month' : view
  const series = useAdminData(useCallback((token: string) => api.adminSeries(token, period), [period]))
  const rows = series.data?.period === period ? series.data.rows : null
  const total = rows?.reduce((sum, row) => ({
    registrations: sum.registrations + row.registrations, payments: sum.payments + row.payments, revenue: sum.revenue + row.revenue,
    plans: Object.fromEntries(PLAN_IDS.map((id) => [id, sum.plans[id] + row.plans[id].count])) as Record<string, number>,
  }), { registrations: 0, payments: 0, revenue: 0, plans: Object.fromEntries(PLAN_IDS.map((id) => [id, 0])) as Record<string, number> })
  return (
    <section className="admin-section" aria-labelledby="admin-series-title">
      <div className="admin-section-head">
        <h2 className="field-label" id="admin-series-title">Регистрации и оплаты</h2>
        <div role="tablist" aria-label="Период" className="admin-chips">
          {PERIODS.map(({ id, label }) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} className={`button small ${view === id ? 'primary' : 'ghost'}`} onClick={() => setView(id)}>{label}</button>
          ))}
          {view !== 'calendar' && <button type="button" className="button small ghost" onClick={() => void series.refresh()} disabled={series.loading} aria-label="Обновить"><RefreshCw aria-hidden="true" className={series.loading ? 'spinner' : undefined} /></button>}
        </div>
      </div>
      {view === 'calendar' ? <AdminCalendar /> : <>
      {series.error && <Notice tone={series.error.offline ? 'offline' : 'error'}>{series.error.message}</Notice>}
      {!rows && !series.error && <Loading text="Загружаем статистику…" />}
      {rows && rows.length > 0 && total && (
        <>
          {period !== 'year' && (
            <div className="admin-charts">
              <ColumnChart title="Выручка, ₽" rows={rows} value={(row) => row.revenue} format={(value) => formatRub(value)} />
              <ColumnChart title="Регистрации" rows={rows} value={(row) => row.registrations} format={(value) => numberFormat.format(value)} tone="green" />
            </div>
          )}
          <div className="table-scroll">
            <table className="pay-table stats-table admin-table">
              <thead>
                <tr>
                  <th scope="col">Период</th><th scope="col" className="num">Регистрации</th><th scope="col" className="num">Оплаты</th>
                  {PLAN_IDS.map((id) => <th key={id} scope="col" className="num" title={`Оплаты на ${PLAN_LABEL[id]}`}>{PLAN_LABEL[id]}</th>)}
                  <th scope="col" className="num">Выручка, ₽</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.period} className={!row.registrations && !row.payments ? 'is-zero' : undefined}>
                    <th scope="row">{formatPeriodKey(row.period)}</th>
                    <td className="num mono">{numberFormat.format(row.registrations)}</td>
                    <td className="num mono">{numberFormat.format(row.payments)}</td>
                    {PLAN_IDS.map((id) => <td key={id} className="num mono" title={row.plans[id].count ? `${formatRub(row.plans[id].revenue)} ₽` : undefined}>{row.plans[id].count ? numberFormat.format(row.plans[id].count) : '—'}</td>)}
                    <td className="num mono accent">{formatRub(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Итого</th>
                  <td className="num mono">{numberFormat.format(total.registrations)}</td>
                  <td className="num mono">{numberFormat.format(total.payments)}</td>
                  {PLAN_IDS.map((id) => <td key={id} className="num mono">{numberFormat.format(total.plans[id] ?? 0)}</td>)}
                  <td className="num mono accent">{formatRub(total.revenue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      </>}
    </section>
  )
}
