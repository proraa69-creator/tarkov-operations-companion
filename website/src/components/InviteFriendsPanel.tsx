import { BadgeCheck, CreditCard, Link2, LoaderCircle, Pencil, Save, ShieldCheck, Trophy, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api, errorMessage, type InviteProgram, type InviteRank, type InviteReward } from '../api'
import { useAuth } from '../auth'
import { normalizeReferralCode, REFERRAL_CODE_PATTERN } from '../storage'
import { audienceLink } from './AudienceLinks'
import { CopyButton } from './CopyButton'
import { Notice } from './Notice'
import { bonusText, countText, DAY_WORDS, INVITE_RANKS, PAYMENT_WORDS, progressText, rankReward, REWARD_STATUS, rewardStatusText } from './inviteProgram'
import { localeTag, tr } from '../i18n'
import '../invites.css'

const formatNumber = (value: number) => new Intl.NumberFormat(localeTag()).format(value)
const formatCreated = (value: string) => new Intl.DateTimeFormat(localeTag(), { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(value))

/** «засчитаются после 1 дня / 2 дней / 5 дней» — the genitive after «после». */
const HOLD_DAY_WORDS = { ru: ['дня', 'дней', 'дней'], en: DAY_WORDS.en } as const

/** The ranks ladder; `confirmed` marks reached ranks (cabinet), without it the ladder is just the list (home page). */
export function RankLadder({ ranks = INVITE_RANKS, confirmed, rewardDays = 7, compact = false }: { ranks?: InviteRank[]; confirmed?: number; rewardDays?: number; compact?: boolean }) {
  return (
    <ol className={`rank-ladder${compact ? ' is-compact' : ''}`} aria-label={tr('Ранги за друзей')}>
      {ranks.map((rank) => {
        const reached = confirmed !== undefined && confirmed >= rank.friends
        return (
          <li key={rank.id} className={`rank-step rank-${rank.id}${reached ? ' is-reached' : ''}`}>
            <span className="rank-friends mono">{rank.friends}</span>
            <span className="rank-text">
              <strong>{rank.title}</strong>
              <span>{rankReward(rank, rewardDays)}</span>
            </span>
            {reached && <BadgeCheck className="rank-check" aria-label={tr('получен')} />}
          </li>
        )
      })}
    </ol>
  )
}

function rewardTitle(reward: InviteReward, ranks: InviteRank[]) {
  if (reward.kind === 'friend') return reward.friend ? tr('Друг {friend}', { friend: reward.friend }) : tr('Друг оплатил подписку')
  return tr('Ранг {rank}', { rank: ranks.find((rank) => rank.id === reward.kind)?.title ?? reward.kind })
}

function rewardDaysText(days: number | 'lifetime') {
  return days === 'lifetime' ? tr('Premium навсегда') : `+${countText(days, DAY_WORDS)}`
}

/**
 * «Пригласи друга» in the cabinet (accounts of kind 'user' only; streamers have their own program and the server
 * answers 403 to them): the personal code and link, counters, rank and progress, the ladder and the rewards.
 */
export function InviteFriendsPanel() {
  const auth = useAuth()
  const token = auth.token
  const [program, setProgram] = useState<InviteProgram | null>(null)
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    api.invites(token).then(
      (next) => { if (!cancelled) { setProgram(next); setError(null) } },
      (reason: unknown) => {
        if (cancelled) return
        // 403: not a player (streamer); 404/405: a server without the program yet — the panel just stays hidden.
        if (reason instanceof ApiError && (reason.status === 403 || reason.status === 404 || reason.status === 405)) { setHidden(true); return }
        setError({ message: errorMessage(reason), offline: reason instanceof ApiError && reason.network })
      },
    )
    return () => { cancelled = true }
  }, [token])

  if (hidden) return null

  return (
    <section className="panel invite-panel" aria-labelledby="friends-title">
      <div className="panel-header">
        <div className="panel-title" id="friends-title"><Users aria-hidden="true" />{tr('Пригласи друга')}</div>
        {program?.rank ? <span className={`tag brass rank-badge rank-${program.rank.id}`}><Trophy aria-hidden="true" />{program.rank.title}</span> : <span className="tag">{tr('Без ранга')}</span>}
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 16 }}>
        {error && <Notice tone={error.offline ? 'offline' : 'error'} title={tr('Не удалось загрузить программу')}>{tr(error.message)}</Notice>}
        {!program && !error && <div className="muted" style={{ fontSize: 14 }}><LoaderCircle className="spinner" size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />{tr('Загружаем ваш код…')}</div>}
        {program && <ProgramView program={program} onChange={setProgram} />}
        <div className="how-it-works">
          <div className="field-label">{tr('Правила')}</div>
          <p className="invite-rules">
            {tr('Друг получает скидку {discount} % на первый месяц. Вы — {bonus} Premium за каждого друга, который оплатил первый месяц со скидкой {discount} %, даже если сами вы ещё не платили; дни начисляются после проверки ({hold}). Друг засчитывается, когда его приложение Raid OS на ПК привязало аккаунт Escape from Tarkov: один аккаунт игры — один друг. Любой возврат оплаты друга отменяет его дни и бонус ранга, если друзей для ранга больше не хватает. Награды — дни Premium, деньгами не выводятся. Накрутка аннулирует награды.', {
              discount: program?.discountPercent ?? 20,
              bonus: bonusText(program?.rewardDays ?? 7),
              hold: countText(program?.holdDays ?? 3, DAY_WORDS),
            })}
          </p>
        </div>
      </div>
    </section>
  )
}

function ProgramView({ program, onChange }: { program: InviteProgram; onChange: (next: InviteProgram) => void }) {
  const link = audienceLink(program.code)
  const ranks = program.ranks.length ? program.ranks : INVITE_RANKS
  const previous = [...ranks].reverse().find((rank) => program.confirmed >= rank.friends)?.friends ?? 0
  const share = program.next ? Math.min(Math.max((program.confirmed - previous) / Math.max(program.next.friends - previous, 1), 0), 1) : 1
  const waiting = Math.max(program.paid - program.confirmed, 0)
  const counters = [
    { icon: UserPlus, label: tr('Зарегистрировались'), value: program.invited, meta: tr('по вашему коду') },
    { icon: CreditCard, label: tr('Оплатили'), value: program.paid, meta: tr('первую подписку') },
    { icon: ShieldCheck, label: tr('Подтверждено'), value: program.confirmed, meta: tr('после проверки') },
  ]
  return (
    <>
      <div className="ref-top" style={{ marginBottom: 0 }}>
        <div className="field">
          <span className="field-label">{tr('Ваш код')}</span>
          <div className="copy-row"><code data-testid="invite-code">{program.code}</code><CopyButton value={program.code} /></div>
        </div>
        <div className="field">
          <span className="field-label"><Link2 size={12} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 5 }} />{tr('Ссылка для друга')}</span>
          <div className="copy-row"><code title={link}>{link}</code><CopyButton value={link} /></div>
        </div>
      </div>
      {program.invited === 0 && <ChangeCode code={program.code} onChange={onChange} />}

      <div className="stat-grid ref-stats">
        {counters.map(({ icon: Icon, label, value, meta }) => (
          <div key={label} className="stat-card">
            <div className="stat-label"><Icon aria-hidden="true" />{label}</div>
            <div className="stat-value mono">{formatNumber(value)}</div>
            <div className="stat-meta">{meta}</div>
          </div>
        ))}
      </div>

      <div className="invite-progress">
        <div className="invite-progress-head">
          <span className="invite-progress-text">{progressText(program)}</span>
          {program.next && <span className="mono dim">{formatNumber(program.confirmed)} / {formatNumber(program.next.friends)}</span>}
        </div>
        <div className="invite-bar" role="progressbar" aria-label={tr('Прогресс до следующего ранга')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
          <span style={{ transform: `scaleX(${share})` }} />
        </div>
        {waiting > 0 && <span className="field-hint">{tr('Ещё {payments} на проверке — засчитаются после {days}.', { payments: countText(waiting, PAYMENT_WORDS), days: countText(program.holdDays, HOLD_DAY_WORDS) })}</span>}
      </div>

      <RankLadder ranks={ranks} confirmed={program.confirmed} rewardDays={program.rewardDays} />

      <div className="invite-rewards">
        <div className="field-label">{tr('Награды')}</div>
        {program.rewards.length === 0 ? (
          <div className="muted" style={{ fontSize: 14 }}>{tr('Пока наград нет. Поделитесь ссылкой — как только друг оплатит первый месяц со скидкой, здесь появится {bonus} Premium.', { bonus: bonusText(program.rewardDays) })}</div>
        ) : (
          <ul className="reward-list">
            {program.rewards.map((reward) => {
              const status = REWARD_STATUS[reward.status] ?? { label: reward.status, tone: '' }
              return (
                <li key={reward.id} className="reward-item">
                  <div className="reward-main">
                    <strong>{rewardTitle(reward, ranks)}</strong>
                    <span className="dim mono">{formatCreated(reward.createdAt)} · {rewardDaysText(reward.days)}</span>
                  </div>
                  <span className={`tag ${status.tone}`}>{rewardStatusText(reward)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}

function ChangeCode({ code, onChange }: { code: string; onChange: (next: InviteProgram) => void }) {
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(code)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    const normalized = normalizeReferralCode(value)
    if (!REFERRAL_CODE_PATTERN.test(normalized)) { setError(tr('Код: 3–24 символа, латиница, цифры, «_» или «-».')); return }
    if (normalized === code) { setOpen(false); return }
    if (!auth.token) return
    setBusy(true)
    setError(null)
    try {
      onChange(await api.setInviteCode(auth.token, normalized))
      setOpen(false)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="invite-change">
        <button type="button" className="button ghost small" onClick={() => { setValue(code); setError(null); setOpen(true) }}><Pencil aria-hidden="true" />{tr('Изменить код')}</button>
        <span className="field-hint">{tr('Сменить код можно, пока по нему никто не зарегистрировался.')}</span>
      </div>
    )
  }
  return (
    <form className="invite-change" onSubmit={save} style={{ display: 'grid', gap: 8 }}>
      <div className="inline-form">
        <input className="input code" aria-label={tr('Новый код')} value={value} maxLength={24} spellCheck={false} autoComplete="off" placeholder="RAID-ARTEM" onChange={(e) => setValue(e.target.value.toUpperCase())} />
        <button type="submit" className="button primary" disabled={busy || value.trim().length < 3}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}{tr('Сохранить')}</button>
        <button type="button" className="button ghost" disabled={busy} onClick={() => setOpen(false)}><X aria-hidden="true" />{tr('Отмена')}</button>
      </div>
      <span className="field-hint">{tr('3–24 символа: латиница, цифры, «_» или «-». Старый код перестанет работать.')}</span>
      {error && <Notice tone="error">{tr(error)}</Notice>}
    </form>
  )
}
