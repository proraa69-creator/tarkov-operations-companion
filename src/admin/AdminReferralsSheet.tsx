import { useEffect, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, Clock3, Gift, Search, UserPlus, Users, Wallet, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { adminApi, type AdminReferralFriend, type AdminReferralReward, type AdminReferrals, type AdminReferrer, type AdminReferrerDetail, type ReferralSort } from './adminApi'
import { accountText, count, dateOnly, errorText, money } from './adminFormat'
import { AdminEmpty, AdminLoading } from './adminShared'

const SORTS: Array<{ id: ReferralSort; label: string }> = [
  { id: 'invited', label: 'Больше друзей' },
  { id: 'paid', label: 'Больше оплат' },
  { id: 'days', label: 'Больше дней' },
  { id: 'recent', label: 'Недавние' },
]
const REWARD_KIND: Record<string, string> = { friend: 'за друга', scout: 'ранг Scout', operator: 'ранг Operator', 'squad-leader': 'ранг Squad Leader', 'raid-commander': 'ранг Raid Commander', legend: 'ранг Legend' }

/** The state of a reward in words, as on the site: на проверке до DATE, у администрации, начислено DATE, не засчитано. */
function rewardText(reward: AdminReferralReward) {
  if (reward.status === 'pending') return reward.waitingEft ? 'на проверке: друг ещё не вошёл в приложение' : reward.releaseAt ? `на проверке до ${dateOnly(reward.releaseAt)}` : 'на проверке'
  if (reward.status === 'review') return 'у администрации'
  if (reward.status === 'granted') return reward.decidedAt ? `начислено ${dateOnly(reward.decidedAt)}` : 'начислено'
  return reward.comment ? `не засчитано: ${reward.comment}` : 'не засчитано'
}
const rewardDays = (days: number | 'lifetime') => days === 'lifetime' ? 'навсегда' : `+${days} дн.`
const referrerName = (referrer: Pick<AdminReferrer, 'email' | 'nickname' | 'deleted'>) => accountText(referrer.deleted ? undefined : referrer.email, referrer.nickname)

/**
 * «Пригласи друга» of the admin app (owner, 03.11.2026), as «Привлечение друзей» on the site: who brought friends, how
 * many paid, the days for them; a referrer opens his friends.
 */
export function ReferralsSheet({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ReferralSort>('invited')
  const [result, setResult] = useState<{ key: string; data?: AdminReferrals; error?: string } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const key = `${query}|${sort}`

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search), 300)
    return () => window.clearTimeout(timer)
  }, [search])
  useEffect(() => {
    let active = true
    adminApi.referrals(query, sort).then(
      (data) => { if (active) setResult({ key, data }) },
      (reason: unknown) => { if (active) setResult({ key, error: errorText(reason) }) },
    )
    return () => { active = false }
  }, [query, sort, key])

  // The previous list stays while the next one loads; an error belongs to its own request.
  const data = result?.data ?? null
  const error = result?.key === key ? result.error ?? '' : ''
  const summary = data?.summary
  return <div className="admin-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="panel admin-user-sheet admin-wide-sheet" role="dialog" aria-modal="true" aria-label={uiText('Пригласи друга')}>
      <header className="admin-sheet-head"><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Назад')}><ArrowLeft size={18} /></button><div><strong>{uiText('Пригласи друга')}</strong><small>{uiText('Кто привёл друзей и сколько из них оплатили')}</small></div><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button></header>
      <div className="admin-sheet-scroll">
        {error && <div className="admin-inline-error" role="alert">{uiText(error)}</div>}
        {!data && !error && <AdminLoading />}
        {summary && <>
          <div className="admin-overview admin-referral-cards">
            <article><span><Users size={16} />{uiText('Пригласили друзей')}</span><strong>{count.format(summary.referrers)}</strong><small>{uiText(`кодов у игроков: ${count.format(summary.withCode)}`)}</small></article>
            <article><span><UserPlus size={16} />{uiText('Пришло друзей')}</span><strong>{count.format(summary.invited)}</strong><small>{uiText(summary.friendsDeleted ? `удалили аккаунт: ${count.format(summary.friendsDeleted)}` : 'по кодам друзей')}</small></article>
            <article><span><Wallet size={16} />{uiText('Оплатили')}</span><strong>{count.format(summary.paid)}</strong><small>{uiText(`не оплатили: ${count.format(summary.unpaid)}`)}</small></article>
            <article><span><Gift size={16} />{uiText('Дней начислено')}</span><strong>{count.format(summary.days.granted)}</strong><small>{uiText(`на проверке ${count.format(summary.days.pending)} · у администрации ${count.format(summary.days.review)}`)}</small></article>
          </div>
          <p className="admin-referral-rules">{uiText(`За оплатившего друга — ${summary.rewardDays} дн., проверка ${summary.holdDays} дн.; другу скидка ${summary.discountPercent} % на первый месяц.${summary.waitingEft ? ` Ждут первого входа друга в приложение: ${summary.waitingEft}.` : ''}`)}</p>
        </>}
        {data && <>
          <label className="admin-search admin-sheet-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={uiText('Поиск по почте или нику')} aria-label={uiText('Поиск по почте или нику')} />{search && <button type="button" onClick={() => setSearch('')} aria-label={uiText('Очистить')}><X size={16} /></button>}</label>
          <div className="admin-chip-row admin-sheet-chips" role="group" aria-label={uiText('Сортировка')}>
            {SORTS.map((item) => <button type="button" key={item.id} className={sort === item.id ? 'active' : ''} aria-pressed={sort === item.id} onClick={() => setSort(item.id)}>{uiText(item.label)}</button>)}
          </div>
          <div className="admin-list admin-referrer-list">
            {data.referrers.map((referrer) => <button type="button" className="admin-user-row" key={referrer.id} onClick={() => setOpen(referrer.id)}>
              <span className={`admin-avatar${referrer.paid > 0 ? ' active' : ''}`}>{(referrer.email ?? referrer.nickname ?? '?').slice(0, 1).toUpperCase()}</span>
              <span className="admin-row-copy">
                <strong>{referrerName(referrer)}</strong>
                <small>{uiText([referrer.code ? `код ${referrer.code}` : '', referrer.rank?.title ?? '', referrer.streamer ? 'стример' : '', referrer.blocked ? 'заблокирован' : ''].filter(Boolean).join(' · ') || 'без ранга')}</small>
                <small>{uiText(`друзей ${referrer.invited} · оплатили ${referrer.paid} · не оплатили ${referrer.unpaid}`)}</small>
              </span>
              <span className="admin-row-side"><strong>{uiText(referrer.lifetime ? 'навсегда' : `+${count.format(referrer.days.granted)} дн.`)}</strong>{referrer.days.pending + referrer.days.review > 0 && <small>{uiText(`ждут ${count.format(referrer.days.pending + referrer.days.review)} дн.`)}</small>}</span>
              <ChevronRight size={17} />
            </button>)}
            {!data.referrers.length && <AdminEmpty text={query ? 'Никого не нашли' : 'Друзей по приглашениям пока нет'} />}
          </div>
          {data.total > data.referrers.length && <small className="admin-day-more">{uiText(`Показаны ${data.referrers.length} из ${data.total}`)}</small>}
        </>}
      </div>
      {open && <ReferrerSheet id={open} onClose={() => setOpen(null)} />}
    </section>
  </div>
}

function ReferrerSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const [result, setResult] = useState<{ id: string; data?: AdminReferrerDetail; error?: string } | null>(null)
  useEffect(() => {
    let active = true
    adminApi.referrer(id).then(
      (data) => { if (active) setResult({ id, data }) },
      (reason: unknown) => { if (active) setResult({ id, error: errorText(reason) }) },
    )
    return () => { active = false }
  }, [id])
  const data = result?.id === id ? result.data ?? null : null
  const error = result?.id === id ? result.error ?? '' : ''
  const referrer = data?.referrer
  const friendRewards = new Set(data?.friends.map((friend) => friend.reward?.id).filter((value): value is number => value !== undefined))
  const otherRewards = data?.rewards.filter((reward) => !friendRewards.has(reward.id)) ?? []
  return <div className="admin-sheet-backdrop admin-sheet-nested" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="panel admin-user-sheet" role="dialog" aria-modal="true" aria-label={uiText(referrer ? referrerName(referrer) : 'Пригласивший')}>
      <header className="admin-sheet-head"><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Назад')}><ArrowLeft size={18} /></button><div><strong>{referrer ? referrerName(referrer) : uiText('Загружаем…')}</strong><small>{uiText(referrer ? [referrer.code ? `код ${referrer.code}` : '', referrer.rank?.title ?? ''].filter(Boolean).join(' · ') || 'пригласивший' : 'пригласивший')}</small></div><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button></header>
      <div className="admin-sheet-scroll">
        {error && <div className="admin-inline-error" role="alert">{uiText(error)}</div>}
        {!data && !error && <AdminLoading />}
        {referrer && data && <>
          <div className="admin-user-facts admin-facts-two">
            <article><span>{uiText('Друзей')}</span><strong>{count.format(referrer.invited)}</strong><small>{uiText(referrer.friendsDeleted ? `удалили аккаунт: ${referrer.friendsDeleted}` : referrer.lastInvitedAt ? `последний ${dateOnly(referrer.lastInvitedAt)}` : '')}</small></article>
            <article><span>{uiText('Оплатили')}</span><strong>{count.format(referrer.paid)}</strong><small>{uiText(`не оплатили: ${referrer.unpaid}`)}</small></article>
            <article><span>{uiText('Дней начислено')}</span><strong>{uiText(referrer.lifetime ? 'навсегда' : count.format(referrer.days.granted))}</strong><small>{uiText(`на проверке ${referrer.days.pending} · у администрации ${referrer.days.review}`)}</small></article>
            <article><span>{uiText('Ранг')}</span><strong>{uiText(referrer.rank?.title ?? '—')}</strong><small>{uiText(referrer.nextReleaseAt ? `следующее начисление ${dateOnly(referrer.nextReleaseAt)}` : '')}</small></article>
          </div>
          <div className="admin-history">
            <h2>{uiText(`Друзья · ${data.friends.length}`)}</h2>
            {data.friends.map((friend) => <FriendRow key={friend.id} friend={friend} />)}
            {!data.friends.length && <AdminEmpty text="Друзей пока нет" />}
            {otherRewards.length > 0 && <>
              <h2>{uiText(`Бонусы за ранги · ${otherRewards.length}`)}</h2>
              {otherRewards.map((reward) => <article className="admin-grant-row" key={reward.id}>
                <span><strong>{uiText(REWARD_KIND[reward.kind] ?? reward.kind)}</strong><small>{uiText(rewardText(reward))}</small></span>
                <span><strong>{uiText(rewardDays(reward.days))}</strong><small>{dateOnly(reward.createdAt)}</small></span>
              </article>)}
            </>}
          </div>
        </>}
      </div>
    </section>
  </div>
}

function FriendRow({ friend }: { friend: AdminReferralFriend }) {
  const first = friend.first
  return <article className="admin-grant-row admin-friend-row">
    <span>
      <strong>{accountText(friend.deleted ? undefined : friend.email, friend.nickname)}</strong>
      <small>{uiText([`пришёл ${dateOnly(friend.invitedAt)}`, friend.eftBound ? 'вошёл в приложение' : 'ещё не входил в приложение', friend.blocked ? 'заблокирован' : ''].filter(Boolean).join(' · '))}</small>
      {friend.reward && <small className={`admin-reward is-${friend.reward.status}`}>{uiText(`${rewardDays(friend.reward.days)} пригласившему · ${rewardText(friend.reward)}`)}</small>}
    </span>
    <span>
      {friend.paid
        ? <strong className="admin-friend-paid"><Check size={13} />{money(friend.amount)}</strong>
        : <strong className="admin-friend-unpaid"><Clock3 size={13} />{uiText(friend.refunded ? 'возврат' : 'не оплатил')}</strong>}
      <small>{uiText(first ? `оплат ${friend.payments}${first.discountPercent ? ` · скидка ${first.discountPercent} %` : ''}` : 'оплат нет')}</small>
    </span>
  </article>
}
