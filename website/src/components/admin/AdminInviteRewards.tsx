import { Gift } from 'lucide-react'
import { useCallback, useState } from 'react'
import { api, type AdminInviteReward, type InviteRewardStatus } from '../../api'
import { useAuth } from '../../auth'
import { Notice } from '../Notice'
import { Pager } from './AdminPayments'
import { AccountRef, Loading } from './adminShared'
import { dateOnly, failure, formatRub, PLAN_LABEL, PROVIDER_LABEL, REWARD_KIND, REWARD_TONE, rewardStatusText, useAdminData } from './adminData'

const PAGE = 50
const FILTERS: Array<{ id: InviteRewardStatus | ''; label: string }> = [
  { id: '', label: 'Все' },
  { id: 'review', label: 'У администрации' },
  { id: 'pending', label: 'На проверке' },
  { id: 'granted', label: 'Начислено' },
  { id: 'canceled', label: 'Не засчитано' },
]

/** The friend's payment in words: amount, plan, Boosty or ЮKassa, the discount and when it was paid. */
function paymentText(payment: NonNullable<AdminInviteReward['payment']>) {
  return [
    `${formatRub(payment.amount)} ₽`,
    payment.plan ? PLAN_LABEL[payment.plan as keyof typeof PLAN_LABEL] ?? payment.plan : '',
    payment.provider ? PROVIDER_LABEL[payment.provider] : '',
    payment.discountPercent ? `скидка −${payment.discountPercent} %` : '',
    payment.status === 'refunded' ? 'возвращён' : payment.status === 'canceled' ? 'отменён' : payment.paidAt ? `оплачен ${dateOnly.format(new Date(payment.paidAt))}` : '',
  ].filter(Boolean).join(' · ')
}

/**
 * «Награды за друзей» (owner, 17.10.2026: «от кого пришло, кто пришёл, аккаунты их»): every reward says plainly who invited
 * whom with both accounts, what the friend paid and where the reward stands; a reward held for the owner is decided here.
 */
export function AdminInviteRewards() {
  const { token } = useAuth()
  const [status, setStatus] = useState<InviteRewardStatus | ''>('')
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState<number | null>(null)
  const rewards = useAdminData(useCallback((t: string) => api.adminInviteRewards(t, status || undefined, PAGE, page * PAGE), [status, page]))
  const data = rewards.data
  async function decide(reward: AdminInviteReward, decision: 'approve' | 'cancel') {
    if (!token) return
    const comment = decision === 'cancel' ? window.prompt('Почему награда не засчитана? (необязательно)') : ''
    if (comment === null) return
    setBusy(reward.id)
    try { await api.adminDecideInviteReward(token, reward.id, decision, comment.trim() || undefined); await rewards.reload() } catch (reason) { window.alert(failure(reason).message) } finally { setBusy(null) }
  }
  return (
    <section className="panel owner-panel admin-rewards" aria-labelledby="admin-rewards-title">
      <div className="panel-header">
        <div className="panel-title" id="admin-rewards-title"><Gift size={16} aria-hidden="true" /> Награды за друзей</div>
      </div>
      <div className="panel-body owner-body admin-stack">
      <div role="group" aria-label="Статус награды" className="admin-chips">
        {FILTERS.map(({ id, label }) => {
          const count = id ? data?.counts[id] : undefined
          return <button key={id || 'all'} type="button" aria-pressed={status === id} className={`button small ${status === id ? 'primary' : 'ghost'}`} onClick={() => { setStatus(id); setPage(0) }}>{label}{count ? <span className="mono"> {count}</span> : null}</button>
        })}
      </div>
      {rewards.error && <Notice tone={rewards.error.offline ? 'offline' : 'error'}>{rewards.error.message}</Notice>}
      {!data && !rewards.error && <Loading text="Загружаем награды…" />}
      {data && data.rewards.length === 0 && <div className="muted admin-empty">Наград с таким статусом нет.</div>}
      {data && data.rewards.length > 0 && (
        <ul className="admin-reward-list">
          {data.rewards.map((reward) => (
            <li key={reward.id} className="admin-reward">
              <div className="admin-who-line">
                <span className="admin-who-label">Пригласивший:</span> <AccountRef email={reward.inviter} nickname={reward.inviterNickname} deleted={reward.inviterDeleted} />
                {reward.kind === 'friend' && <> <span aria-hidden="true">←</span> <span className="admin-who-label">Друг:</span> <AccountRef email={reward.friend} nickname={reward.friendNickname} deleted={reward.friendDeleted || !reward.friend} /></>}
              </div>
              <div className="admin-who-line admin-origin">
                <span className="tag admin-mini">{reward.days === 'lifetime' ? 'навсегда' : `+${reward.days} дн.`} · {REWARD_KIND[reward.kind] ?? reward.kind}</span>
                <span className={`tag admin-mini ${REWARD_TONE[reward.status] ?? ''}`}>{rewardStatusText(reward)}</span>
                {reward.payment && <span className="dim">Платёж друга: {paymentText(reward.payment)}</span>}
              </div>
              {(reward.decidedBy || (reward.comment && reward.status !== 'canceled')) && (
                <div className="admin-who-line dim">{reward.decidedBy ? `Решение: ${reward.decidedBy}` : ''}{reward.comment && reward.status !== 'canceled' ? ` · ${reward.comment}` : ''}</div>
              )}
              {reward.status === 'review' && (
                <div className="admin-row-actions">
                  <button type="button" className="button small primary" disabled={busy === reward.id} onClick={() => void decide(reward, 'approve')}>Засчитать</button>
                  <button type="button" className="button small ghost" disabled={busy === reward.id} onClick={() => void decide(reward, 'cancel')}>Не засчитывать</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && <Pager page={page} total={data.total} size={PAGE} onPage={setPage} />}
      </div>
    </section>
  )
}
