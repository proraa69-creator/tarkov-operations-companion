import { ChevronDown, Crown, Gift, Hourglass, Search, ShieldQuestion, UserCheck, UserPlus, Users, UserX } from 'lucide-react'
import { Fragment, useCallback, useState, type FormEvent } from 'react'
import { api, type AdminReferralFriend, type AdminReferralReward, type AdminReferralSummary, type AdminReferrer, type ReferralSort } from '../../api'
import { Notice } from '../Notice'
import { plural } from '../inviteProgram'
import { AccountRef, Loading } from './adminShared'
import { dateOnly, dateTime, formatRub, inviteFlagText, numberFormat, PLAN_LABEL, PROVIDER_LABEL, REWARD_KIND, useAdminData } from './adminData'

const SORTS: Array<{ id: ReferralSort; label: string }> = [
  { id: 'invited', label: 'Больше всех привели' },
  { id: 'paid', label: 'Больше оплативших' },
  { id: 'days', label: 'Больше дней' },
  { id: 'recent', label: 'Недавние приглашения' },
]

const count = (value: number) => numberFormat.format(value)
const daysText = (value: number) => `${numberFormat.format(value)} ${plural(value, 'день', 'дня', 'дней')}`

/** How long until a reward on hold goes: «через 5 ч», «через 2 дня»; the hourly check grants an overdue one. */
function untilText(at: string, now: number) {
  const left = Date.parse(at) - now
  if (left <= 0) return 'при ближайшей проверке'
  const hours = Math.ceil(left / 3_600_000)
  if (hours < 24) return `через ${hours} ч`
  const days = Math.ceil(hours / 24)
  return `через ${days} ${plural(days, 'день', 'дня', 'дней')}`
}

/** Where a reward stands, in words (owner: «сколько дней им положено, сколько через сколько будет выдано, и выдано ли»). */
function rewardState(reward: AdminReferralReward, now: number): { text: string; tone: string } {
  const flags = reward.flags.length ? inviteFlagText(reward.flags) : ''
  if (reward.status === 'granted') return { text: `выдано${reward.decidedAt ? ` ${dateOnly.format(new Date(reward.decidedAt))}` : ''}`, tone: 'green' }
  if (reward.status === 'canceled') return { text: `не засчитано${reward.comment ? `: ${reward.comment}` : flags ? `: ${flags}` : ''}`, tone: 'danger' }
  if (reward.status === 'review') return { text: `ждёт вашего решения${flags ? ` (${flags})` : ''}: «Платежи» → «Награды за друзей»`, tone: 'brass' }
  if (reward.waitingEft) return { text: 'выдадим, когда друг войдёт в приложение для ПК', tone: '' }
  return { text: reward.releaseAt ? `будет выдано ${dateTime.format(new Date(reward.releaseAt))}, ${untilText(reward.releaseAt, now)}` : 'на проверке', tone: '' }
}

const rewardSize = (reward: AdminReferralReward) => `${reward.days === 'lifetime' ? 'навсегда' : `+${reward.days} дн.`} · ${REWARD_KIND[reward.kind] ?? reward.kind}`

/** The friend's first payment: amount, plan, service, the friend discount (or none) and the day; more payments after it. */
function paymentText(friend: AdminReferralFriend) {
  const first = friend.first
  if (!first) return friend.paid ? `${formatRub(friend.amount)} ₽` : ''
  const parts = [
    `${formatRub(first.amount)} ₽`,
    PLAN_LABEL[first.plan as keyof typeof PLAN_LABEL] ?? first.plan,
    PROVIDER_LABEL[first.provider] ?? first.provider,
    first.discountPercent ? `скидка друга −${first.discountPercent} %` : 'без скидки друга',
    first.paidAt ? dateOnly.format(new Date(first.paidAt)) : '',
  ].filter(Boolean)
  const more = friend.payments > 1 ? ` · всего ${count(friend.payments)} ${plural(friend.payments, 'оплата', 'оплаты', 'оплат')} на ${formatRub(friend.amount)} ₽` : ''
  return `${friend.refunded ? 'возвращён: ' : 'первая оплата: '}${parts.join(' · ')}${more}`
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

/** The program at a glance: who takes part, whom they brought, who paid, and the days granted, coming and waiting for you. */
function ReferralSummary({ summary }: { summary: AdminReferralSummary }) {
  const top = summary.top
  const ranks = summary.ranks.filter((rank) => rank.bonusDays !== 0)
    .map((rank) => `${rank.friends} — ${rank.bonusDays === 'lifetime' ? 'Premium навсегда' : `+${daysText(rank.bonusDays)}`}`).join(', ')
  return (
    <>
      <div className="stat-grid admin-stats">
        <Stat icon={Users} label="Участвуют" value={count(summary.referrers)} meta={`привели хотя бы одного друга · открыли «Пригласи друга»: ${count(summary.withCode)}`} accent />
        <Stat icon={UserPlus} label="Привели всего" value={count(summary.invited)} meta={summary.friendsDeleted ? `из них удалили аккаунт: ${count(summary.friendsDeleted)}` : 'регистраций по кодам друзей'} />
        <Stat icon={UserCheck} label="Оплатили" value={count(summary.paid)} meta={summary.invited ? `${Math.round((summary.paid / summary.invited) * 100)} % приглашённых` : 'пока никто'} />
        <Stat icon={UserX} label="Не оплатили" value={count(summary.unpaid)} meta="зарегистрировались, оплаты нет" />
        <Stat icon={Crown} label="Больше всех привёл" value={top ? count(top.invited) : '—'} meta={top ? `${top.email ?? 'аккаунт удалён'}${top.nickname ? ` · ${top.nickname}` : ''}` : 'пока никто'} />
        <Stat icon={Gift} label="Дней выдано" value={count(summary.days.granted)} meta={`наград выдано: ${count(summary.rewards.granted)}${summary.lifetime ? ` · Premium навсегда: ${count(summary.lifetime)}` : ''}`} accent={summary.days.granted > 0} />
        <Stat icon={Hourglass} label="Дней ждут выдачи" value={count(summary.days.pending)} meta={`наград: ${count(summary.rewards.pending)}${summary.waitingEft ? ` · из них ждут входа друга в приложение для ПК: ${count(summary.waitingEft)}` : ''}`} />
        <Stat icon={ShieldQuestion} label="Ждут вашего решения" value={count(summary.rewards.review)} meta={summary.rewards.review ? `${daysText(summary.days.review)} · «Платежи» → «Награды за друзей»` : 'спорных наград нет'} accent={summary.rewards.review > 0} />
      </div>
      <p className="field-hint admin-referral-rules">
        Друг получает −{summary.discountPercent} % на первый месяц. За каждого друга, оплатившего первый месяц со скидкой, пригласившему +{daysText(summary.rewardDays)}: через {daysText(summary.holdDays)} проверки и после входа друга в приложение для ПК. Ранги за подтверждённых друзей: {ranks}.
      </p>
    </>
  )
}

/** «Дни за друзей» of one account: granted, on hold, waiting for the owner. */
function DaysCell({ referrer }: { referrer: AdminReferrer }) {
  const { granted, pending, review } = referrer.days
  if (!granted && !pending && !review && !referrer.lifetime) return <span className="dim">—</span>
  return (
    <span className="admin-referral-days">
      {(granted > 0 || referrer.lifetime) && <span className="tag green admin-mini">выдано {referrer.lifetime ? 'навсегда' : daysText(granted)}</span>}
      {pending > 0 && <span className="tag admin-mini">ждут {daysText(pending)}</span>}
      {review > 0 && <span className="tag brass admin-mini">у вас {daysText(review)}</span>}
    </span>
  )
}

/** The nearest grant of an account's rewards on hold, and how many wait for the friend's app. */
function NextGrant({ referrer, now }: { referrer: AdminReferrer; now: number }) {
  if (!referrer.nextReleaseAt && !referrer.waitingEft) return <span className="dim">—</span>
  return (
    <span className="admin-referral-next">
      {referrer.nextReleaseAt && <span><span className="mono">{dateTime.format(new Date(referrer.nextReleaseAt))}</span> <span className="dim">· {untilText(referrer.nextReleaseAt, now)}</span></span>}
      {referrer.waitingEft > 0 && <span className="dim">ждут входа друга в приложение для ПК: {count(referrer.waitingEft)}</span>}
    </span>
  )
}

/** One account's friends: when each came, paid or not and how, and where his reward stands; then the rank rewards. */
function ReferrerFriends({ id }: { id: string }) {
  const detail = useAdminData(useCallback((token: string) => api.adminReferrer(token, id), [id]))
  const [now] = useState(() => Date.now())
  if (detail.error) return <Notice tone={detail.error.offline ? 'offline' : 'error'}>{detail.error.message}</Notice>
  if (!detail.data) return <Loading text="Загружаем друзей…" />
  const { friends, rewards } = detail.data
  return (
    <div className="admin-stack admin-referral-friends">
      {friends.length === 0 ? <div className="muted admin-empty">По коду пока никто не зарегистрировался.</div> : (
        <ul className="admin-reward-list" aria-label="Приглашённые друзья">
          {friends.map((friend) => {
            const state = friend.reward ? rewardState(friend.reward, now) : undefined
            return (
              <li key={friend.id} className="admin-reward">
                <div className="admin-who-line">
                  <span className="admin-who-label">Друг:</span> <AccountRef email={friend.email} nickname={friend.nickname} deleted={friend.deleted} />
                  <span className="dim">· регистрация {dateOnly.format(new Date(friend.invitedAt))}</span>
                  {friend.blocked && <span className="tag danger admin-mini">заблокирован</span>}
                  {!friend.eftBound && !friend.deleted && <span className="tag admin-mini" title="Игровой аккаунт привязывается при входе в приложение для ПК">не входил в приложение для ПК</span>}
                </div>
                <div className="admin-who-line admin-origin">
                  <span className={`tag admin-mini ${friend.paid ? 'green' : friend.refunded ? 'danger' : ''}`}>{friend.paid ? 'оплатил' : friend.refunded ? 'платёж возвращён' : 'не оплатил'}</span>
                  {(friend.paid || friend.refunded) && <span className="dim">{paymentText(friend)}</span>}
                </div>
                <div className="admin-who-line admin-origin">
                  {friend.reward && state ? <>
                    <span className="tag admin-mini">{rewardSize(friend.reward)}</span>
                    <span className={`tag admin-mini ${state.tone}`}>{state.text}</span>
                  </> : <span className="dim">{friend.paid
                    ? friend.first?.discountPercent ? 'без награды' : 'без награды: первая оплата прошла без скидки друга'
                    : 'награда — после оплаты первого месяца со скидкой друга'}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {rewards.length > 0 && (
        <ul className="admin-reward-list" aria-label="Награды за ранги">
          {rewards.map((reward) => {
            const state = rewardState(reward, now)
            return (
              <li key={reward.id} className="admin-reward">
                <div className="admin-who-line admin-origin">
                  <span className="tag admin-mini">{rewardSize(reward)}</span>
                  <span className={`tag admin-mini ${state.tone}`}>{state.text}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * «Привлечение друзей» (owner, 03.11.2026: «список тех, кто привел друзей… сколько он привел человек. Сколько оплатили,
 * сколько зарегистрировались но не оплатили… сколько людей участвуют в этой программе… максимальное количество… сколько
 * дней им положено, сколько через сколько будет выдано, и выдано ли им»): the totals of «Пригласи друга», every account
 * that brought friends, and a row opens its friends with the reward for each. Decisions on rewards held for the owner
 * stay in «Платежи» → «Награды за друзей».
 */
export function AdminReferrals() {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ReferralSort>('invited')
  const [open, setOpen] = useState<string | null>(null)
  const [now] = useState(() => Date.now())
  const referrals = useAdminData(useCallback((token: string) => api.adminReferrals(token, query, sort), [query, sort]))
  const data = referrals.data
  const submit = (event: FormEvent) => { event.preventDefault(); setQuery(search.trim()); setOpen(null) }

  return (
    <div className="admin-stack">
      {referrals.error && <Notice tone={referrals.error.offline ? 'offline' : 'error'}>{referrals.error.message}</Notice>}
      {!data && !referrals.error && <Loading text="Загружаем статистику приглашений…" />}
      {data && <ReferralSummary summary={data.summary} />}
      <div className="admin-filters">
        <form className="inline-form admin-search" onSubmit={submit} role="search">
          <input className="input" type="search" aria-label="Поиск по e-mail, нику или коду" placeholder="Поиск пригласившего по e-mail, нику в игре или коду" value={search} maxLength={254} onChange={(event) => setSearch(event.target.value)} />
          <button type="submit" className="button ghost"><Search aria-hidden="true" />Найти</button>
        </form>
        <div role="group" aria-label="Сортировка" className="admin-chips">
          {SORTS.map(({ id, label }) => <button key={id} type="button" aria-pressed={sort === id} className={`button small ${sort === id ? 'primary' : 'ghost'}`} onClick={() => { setSort(id); setOpen(null) }}>{label}</button>)}
        </div>
      </div>
      {data && (data.referrers.length === 0 ? <div className="muted admin-empty">{query ? 'Никого не нашли.' : 'Пока никто не привёл друзей.'}</div> : (
        <div className="table-scroll admin-users-wrap">
          {/* The account list's layout (admin-users): a card per inviter on the phone. */}
          <table className="pay-table admin-table admin-users admin-referrals">
            <thead>
              <tr>
                <th scope="col">Пригласивший</th><th scope="col" className="num">Привёл</th><th scope="col" className="num">Оплатили</th><th scope="col" className="num">Не оплатили</th>
                <th scope="col">Дни за друзей</th><th scope="col">Ближайшая выдача</th><th scope="col"><span className="visually-hidden">Друзья</span></th>
              </tr>
            </thead>
            <tbody>
              {data.referrers.map((referrer) => {
                const expanded = open === referrer.id
                return (
                  <Fragment key={referrer.id}>
                    <tr className={expanded ? 'is-open' : undefined}>
                      <th scope="row" className="admin-email">
                        <AccountRef email={referrer.email} nickname={referrer.nickname} deleted={referrer.deleted} />
                        <span className="admin-badges">
                          {referrer.code && <span className="tag admin-mini mono" title="Код приглашения">{referrer.code}</span>}
                          {referrer.rank && <span className="tag brass admin-mini" title={`Ранг: подтверждённых друзей ${count(referrer.confirmed)}`}>{referrer.rank.title}</span>}
                          {referrer.streamer && <span className="tag admin-mini">стример</span>}
                          {referrer.blocked && <span className="tag danger admin-mini">заблокирован</span>}
                        </span>
                      </th>
                      <td className="num mono" data-label="Привёл">{count(referrer.invited)}{referrer.friendsDeleted > 0 && <small className="dim" title="Из них удалили аккаунт"> (−{count(referrer.friendsDeleted)})</small>}</td>
                      <td className="num mono" data-label="Оплатили">{count(referrer.paid)}</td>
                      <td className="num mono" data-label="Не оплатили">{count(referrer.unpaid)}</td>
                      <td data-label="Дни за друзей"><DaysCell referrer={referrer} /></td>
                      <td data-label="Ближайшая выдача"><NextGrant referrer={referrer} now={now} /></td>
                      <td className="admin-row-action"><button type="button" className="button ghost small" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : referrer.id)}><ChevronDown aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />{expanded ? 'Скрыть' : 'Друзья'}</button></td>
                    </tr>
                    {expanded && <tr className="owner-detail"><td colSpan={7}><ReferrerFriends id={referrer.id} /></td></tr>}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
