import { CreditCard, Gift, LineChart, UserPlus, X } from 'lucide-react'
import { useCallback } from 'react'
import { api, type PlanId } from '../../api'
import { Notice } from '../Notice'
import { Loading, PlanCounts } from './adminShared'
import { formatRub, numberFormat, PLAN_IDS, useAdminData } from './adminData'
import { pickedRangeText } from '../../../../src/shared/adminPeriod'

const rub = (value: number) => `${formatRub(value)} ₽`

/**
 * «Сводка за период» (owner, 15.11.2026): the days picked on «Календарь» — revenue, payments and the repeat ones,
 * registrations, who paid, the free periods of the accounts registered then (dead / real) and the plans. Nothing «за
 * сегодня», no squads. The cross drops the pick.
 */
export function AdminPeriodSummary({ from, to, onClear }: { from: string; to: string; onClear: () => void }) {
  const stats = useAdminData(useCallback((token: string) => api.adminStats(token, from, to), [from, to]))
  // Another period's answer is not shown under this one's title.
  const data = stats.data?.range.from === from && stats.data.range.to === to ? stats.data : null
  const revenue = data?.revenue
  const payers = data?.payers
  const trials = data?.trialConversion
  const plans = revenue && Object.fromEntries(PLAN_IDS.map((id) => [id, { count: revenue.byPlan[id]?.count ?? 0, revenue: revenue.byPlan[id]?.amount ?? 0 }])) as Record<PlanId, { count: number; revenue: number }>
  return (
    <section className="admin-period" aria-label={`Сводка за период ${pickedRangeText(from, to)}`}>
      <div className="admin-period-head">
        <strong>Сводка за период <span className="mono">{pickedRangeText(from, to)}</span></strong>
        <button type="button" className="icon-button" aria-label="Снять выбор" onClick={onClear}><X size={16} aria-hidden="true" /></button>
      </div>
      {stats.error && <Notice tone={stats.error.offline ? 'offline' : 'error'}>{stats.error.message}</Notice>}
      {!data && !stats.error && <Loading text="Считаем период…" />}
      {data && revenue && payers && trials && (
        <>
          <div className="stat-grid admin-stats">
            <div className="stat-card is-accent">
              <div className="stat-label"><LineChart aria-hidden="true" />Выручка за период</div>
              <div className="stat-value mono">{rub(revenue.total)}</div>
              <div className="stat-meta">оплат {numberFormat.format(revenue.payments)}{revenue.repeatPayments !== undefined ? ` · повторных ${numberFormat.format(revenue.repeatPayments)}` : ''}{revenue.refunds.count > 0 ? ` · возвратов ${numberFormat.format(revenue.refunds.count)}` : ''}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><UserPlus aria-hidden="true" />Регистрации</div>
              <div className="stat-value mono">{numberFormat.format(data.users.new)}</div>
              <div className="stat-meta">новых аккаунтов</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><CreditCard aria-hidden="true" />Платные подписки</div>
              <div className="stat-value mono">{numberFormat.format(payers.paidInRange)}</div>
              <div className="stat-meta">впервые {numberFormat.format(payers.newInRange)} · повторно {numberFormat.format(payers.repeatInRange)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><Gift aria-hidden="true" />Пробный период</div>
              <div className="stat-value mono">{numberFormat.format(trials.trialStarted)}</div>
              <div className="stat-meta">{trials.dead !== undefined && trials.alive !== undefined ? `мёртвых ${numberFormat.format(trials.dead)} · реальных ${numberFormat.format(trials.alive)} · ` : ''}оплатили {numberFormat.format(trials.laterPaid)}</div>
            </div>
          </div>
          {plans && <PlanCounts columns={[{ title: 'За период', plans }]} />}
        </>
      )}
    </section>
  )
}
