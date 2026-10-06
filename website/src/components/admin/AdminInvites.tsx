import { BadgeCheck, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { api, type AdminInviteReward, type InviteRewardStatus } from '../../api'
import { Notice } from '../Notice'
import { Loading } from './adminShared'
import { Pager } from './AdminPayments'
import { dateOnly, dateTime, failure, formatRub, numberFormat, PAYMENT_STATUS, useAdminData, type Failure } from './adminData'

const PAGE = 100

/** «На проверке» first: those need the owner. */
const FILTERS: Array<{ id: InviteRewardStatus; label: string }> = [
  { id: 'review', label: 'На проверке' },
  { id: 'pending', label: 'Ждут 14 дней' },
  { id: 'granted', label: 'Начислены' },
  { id: 'canceled', label: 'Не засчитаны' },
]

const INVITE_STATUS: Record<InviteRewardStatus, { label: string; tone: string }> = {
  review: { label: 'На проверке', tone: 'brass' },
  pending: { label: 'Ждёт 14 дней', tone: '' },
  granted: { label: 'Начислено', tone: 'green' },
  canceled: { label: 'Не засчитано', tone: 'danger' },
}

/** Why a reward went to the owner (server/src/services/invites.ts, FraudFlag + the check before release). */
const INVITE_FLAG_LABEL: Record<string, string> = {
  'same-device': 'Одно устройство с пригласившим',
  'same-address': 'Тот же адрес регистрации',
  'address-cluster': 'Много друзей с одного адреса',
  'same-card': 'Карта пригласившего',
  'card-reused': 'Карта уже была у другого друга',
  burst: 'Слишком много за сутки',
  'payment-or-account': 'Платёж отменён или аккаунт пригласившего заблокирован',
}

const KIND_LABEL: Record<string, string> = { operator: 'Ранг Operator', 'squad-leader': 'Ранг Squad Leader', 'raid-commander': 'Ранг Raid Commander', legend: 'Ранг Legend' }

function daysText(days: number | 'lifetime') {
  return days === 'lifetime' ? 'навсегда' : `${numberFormat.format(days)} дн.`
}

/** «Друзья»: rewards of «Пригласи друга» — the ones in review and on the 14-day hold can be granted or cancelled. */
export function AdminInvites() {
  const [status, setStatus] = useState<InviteRewardStatus>('review')
  const [page, setPage] = useState(0)
  const [comments, setComments] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [actionError, setActionError] = useState<Failure | null>(null)
  const rewards = useAdminData(useCallback((token: string) => api.adminInviteRewards(token, status, PAGE, page * PAGE), [status, page]))
  const data = rewards.data

  async function decide(item: AdminInviteReward, decision: 'approve' | 'cancel') {
    if (!rewards.token) return
    setBusy(item.id)
    setActionError(null)
    try {
      await api.adminDecideInviteReward(rewards.token, item.id, decision, comments[item.id]?.trim() || undefined)
      setComments((current) => { const next = { ...current }; delete next[item.id]; return next })
      await rewards.reload()
    } catch (reason) {
      setActionError(failure(reason))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="admin-stack">
      <div className="admin-filters">
        <div role="group" aria-label="Статус награды" className="admin-chips">
          {FILTERS.map(({ id, label }) => {
            const count = data?.counts[id]
            return (
              <button key={id} type="button" aria-pressed={status === id} className={`button small ${status === id ? 'primary' : 'ghost'}`} onClick={() => { setStatus(id); setPage(0) }}>
                {label}{count !== undefined ? <span className="mono"> · {numberFormat.format(count)}</span> : null}
              </button>
            )
          })}
        </div>
        <button type="button" className="button ghost small" disabled={rewards.loading} onClick={() => void rewards.refresh()}>
          {rewards.loading ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Обновить
        </button>
      </div>
      <p className="field-hint" style={{ margin: 0 }}>
        7 дней Premium за друга начисляются сами через 14 дней после его первой оплаты. Подозрительные награды (одно устройство, адрес или карта, всплеск за сутки) ждут вашего решения. Возвращённые платежи не засчитываются.
      </p>
      {rewards.error && <Notice tone={rewards.error.offline ? 'offline' : 'error'}>{rewards.error.message}</Notice>}
      {actionError && <Notice tone={actionError.offline ? 'offline' : 'error'}>{actionError.message}</Notice>}
      {!data && !rewards.error && <Loading text="Загружаем награды…" />}
      {data && data.rewards.length === 0 && <div className="muted admin-empty">Наград с таким статусом нет.</div>}
      {data && data.rewards.length > 0 && (
        <div className="table-scroll">
          <table className="pay-table admin-table">
            <thead>
              <tr>
                <th scope="col">Дата</th><th scope="col">Пригласивший</th><th scope="col">Друг</th><th scope="col" className="num">Оплата, ₽</th>
                <th scope="col">Флаги</th><th scope="col">Срок</th><th scope="col">Статус</th><th scope="col"><span className="visually-hidden">Решение</span></th>
              </tr>
            </thead>
            <tbody>
              {data.rewards.map((item) => {
                const state = INVITE_STATUS[item.status] ?? { label: item.status, tone: '' }
                const open = item.status === 'review' || item.status === 'pending'
                const payment = item.payment ? PAYMENT_STATUS[item.payment.status as keyof typeof PAYMENT_STATUS] : undefined
                return (
                  <tr key={item.id}>
                    <td className="mono">{dateTime.format(new Date(item.createdAt))}</td>
                    <td className="admin-email">{item.inviter}{item.inviterCode ? <div className="mono dim">{item.inviterCode}</div> : null}</td>
                    <td className="admin-email">{item.kind === 'friend' ? item.friend ?? '—' : KIND_LABEL[item.kind] ?? item.kind}</td>
                    <td className="num mono">
                      {item.payment ? <>{formatRub(item.payment.amount)}<div><span className={`tag admin-mini ${payment?.tone ?? ''}`}>{payment?.label ?? item.payment.status}</span></div></> : '—'}
                    </td>
                    <td className="admin-wrap">
                      {item.flags.length === 0 ? <span className="dim">—</span> : (
                        <div className="admin-badges">{item.flags.map((flag) => <span key={flag} className="tag danger admin-mini">{INVITE_FLAG_LABEL[flag] ?? flag}</span>)}</div>
                      )}
                    </td>
                    <td className="mono">
                      {daysText(item.days)}
                      {item.releaseAt ? <div className="dim">до {dateOnly.format(new Date(item.releaseAt))}</div> : null}
                      {item.decidedAt ? <div className="dim">{dateOnly.format(new Date(item.decidedAt))}</div> : null}
                    </td>
                    <td>
                      <span className={`tag ${state.tone}`}>{state.label}</span>
                      {item.decidedBy || item.comment ? <div className="dim admin-wrap" style={{ fontSize: 12 }}>{[item.decidedBy, item.comment].filter(Boolean).join(' · ')}</div> : null}
                    </td>
                    <td>
                      {open && (
                        <div style={{ display: 'grid', gap: 6, minWidth: 200 }}>
                          <input className="input" aria-label={`Комментарий к награде ${item.id}`} placeholder="Комментарий (необязательно)" maxLength={300} value={comments[item.id] ?? ''} onChange={(e) => setComments((c) => ({ ...c, [item.id]: e.target.value }))} />
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button type="button" className="button primary small" disabled={busy === item.id} onClick={() => void decide(item, 'approve')}>
                              {busy === item.id ? <LoaderCircle className="spinner" aria-hidden="true" /> : <BadgeCheck aria-hidden="true" />}Начислить
                            </button>
                            <button type="button" className="button ghost small" disabled={busy === item.id} onClick={() => void decide(item, 'cancel')}><X aria-hidden="true" />Не засчитывать</button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} size={PAGE} onPage={setPage} />}
    </div>
  )
}
