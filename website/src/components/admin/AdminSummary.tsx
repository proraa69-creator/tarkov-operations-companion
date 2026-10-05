import { Banknote, CalendarRange, CreditCard, Gift, LineChart, Radio, RefreshCw, UserPlus, Users, Wallet } from 'lucide-react'
import { useCallback, useState } from 'react'
import { api, type AdminRevenue, type StatsPeriod } from '../../api'
import { Notice } from '../Notice'
import { ColumnChart, Loading } from './adminShared'
import { formatPeriodKey, formatRub, numberFormat, PLAN_IDS, PLAN_LABEL, useAdminData } from './adminData'

const PERIODS: Array<{ id: StatsPeriod; label: string }> = [
  { id: 'day', label: '31 день' },
  { id: 'month', label: '12 месяцев' },
  { id: 'year', label: 'По годам' },
]

const rub = (value: number) => `${formatRub(value)} ₽`

/** «Сводка»: users, subscriptions, revenue, payouts, and tables by day / month / year. */
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
            <Stat icon={Users} label="Пользователи" value={numberFormat.format(data.users.total)} meta={`сегодня +${numberFormat.format(data.users.today)} · 7 дн. +${numberFormat.format(data.users.days7)} · 30 дн. +${numberFormat.format(data.users.days30)}`} />
            <Stat icon={CreditCard} label="Платные подписки" value={numberFormat.format(data.subscriptions.active)} meta="оплаченный срок не истёк" accent />
            <Stat icon={Gift} label="Пробный период" value={numberFormat.format(data.subscriptions.trials)} meta="3 дня по ссылке стримера" />
            <Stat icon={Radio} label="Стримеры" value={numberFormat.format(data.subscriptions.streamers)} meta={data.users.blocked ? `заблокировано аккаунтов: ${numberFormat.format(data.users.blocked)}` : 'бесплатная подписка навсегда'} />
          </div>
          <div className="admin-revenue">
            <RevenueCard title="Выручка сегодня" revenue={data.revenue.today} />
            <RevenueCard title="За этот месяц" revenue={data.revenue.month} />
            <RevenueCard title="За всё время" revenue={data.revenue.all} />
          </div>
          <div className="stat-grid admin-stats">
            <Stat icon={Wallet} label="Начислено стримерам" value={rub(data.payouts.earned)} meta="их доля со всех оплат" />
            <Stat icon={Banknote} label="Выплачено" value={rub(data.payouts.paid)} meta="заявки «Выплачено»" />
            <Stat icon={CalendarRange} label="Ждут выплаты" value={rub(data.payouts.pending)} meta={`заявок: ${numberFormat.format(data.payouts.pendingRequests)}`} accent={data.payouts.pendingRequests > 0} />
            <Stat icon={UserPlus} label="Новые за 30 дней" value={numberFormat.format(data.users.days30)} meta={`за 7 дней: ${numberFormat.format(data.users.days7)}`} />
          </div>
          <p className="field-hint" style={{ margin: 0 }}>Время — московское. Выданные вручную дни подписки не считаются выручкой.</p>
        </>
      )}
      <SeriesSection />
    </div>
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
  const [period, setPeriod] = useState<StatsPeriod>('day')
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
            <button key={id} type="button" role="tab" aria-selected={period === id} className={`button small ${period === id ? 'primary' : 'ghost'}`} onClick={() => setPeriod(id)}>{label}</button>
          ))}
          <button type="button" className="button small ghost" onClick={() => void series.refresh()} disabled={series.loading} aria-label="Обновить"><RefreshCw aria-hidden="true" className={series.loading ? 'spinner' : undefined} /></button>
        </div>
      </div>
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
    </section>
  )
}
