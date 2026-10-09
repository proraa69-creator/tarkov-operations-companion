import { BadgeCheck, CreditCard, Link2, LoaderCircle, Pencil, Save, ShieldCheck, Trophy, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api, errorMessage, type InviteProgram, type InviteRank, type InviteReward } from '../api'
import { useAuth } from '../auth'
import { normalizeReferralCode, REFERRAL_CODE_PATTERN } from '../storage'
import { audienceLink } from './AudienceLinks'
import { CopyButton } from './CopyButton'
import { Notice } from './Notice'
import { bonusText, INVITE_RANKS, plural, progressText, rankReward, REWARD_STATUS, rewardStatusText } from './inviteProgram'
import '../invites.css'

const numberFormat = new Intl.NumberFormat('ru-RU')
const createdFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

/** The ranks ladder; `confirmed` marks reached ranks (cabinet), without it the ladder is just the list (home page). */
export function RankLadder({ ranks = INVITE_RANKS, confirmed, rewardDays = 7, compact = false }: { ranks?: InviteRank[]; confirmed?: number; rewardDays?: number; compact?: boolean }) {
  return (
    <ol className={`rank-ladder${compact ? ' is-compact' : ''}`} aria-label="Ранги за друзей">
      {ranks.map((rank) => {
        const reached = confirmed !== undefined && confirmed >= rank.friends
        return (
          <li key={rank.id} className={`rank-step rank-${rank.id}${reached ? ' is-reached' : ''}`}>
            <span className="rank-friends mono">{rank.friends}</span>
            <span className="rank-text">
              <strong>{rank.title}</strong>
              <span>{rankReward(rank, rewardDays)}</span>
            </span>
            {reached && <BadgeCheck className="rank-check" aria-label="получен" />}
          </li>
        )
      })}
    </ol>
  )
}

function rewardTitle(reward: InviteReward, ranks: InviteRank[]) {
  if (reward.kind === 'friend') return reward.friend ? `Друг ${reward.friend}` : 'Друг оплатил подписку'
  return `Ранг ${ranks.find((rank) => rank.id === reward.kind)?.title ?? reward.kind}`
}

function rewardDaysText(days: number | 'lifetime') {
  return days === 'lifetime' ? 'Premium навсегда' : `+${days} ${plural(days, 'день', 'дня', 'дней')}`
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
        <div className="panel-title" id="friends-title"><Users aria-hidden="true" />Пригласи друга</div>
        {program?.rank ? <span className={`tag brass rank-badge rank-${program.rank.id}`}><Trophy aria-hidden="true" />{program.rank.title}</span> : <span className="tag">Без ранга</span>}
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 16 }}>
        {error && <Notice tone={error.offline ? 'offline' : 'error'} title="Не удалось загрузить программу">{error.message}</Notice>}
        {!program && !error && <div className="muted" style={{ fontSize: 14 }}><LoaderCircle className="spinner" size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Загружаем ваш код…</div>}
        {program && <ProgramView program={program} onChange={setProgram} />}
        <div className="how-it-works">
          <div className="field-label">Правила</div>
          <p className="invite-rules">
            Друг получает скидку {program?.discountPercent ?? 20} % на первый месяц. Вы — {bonusText(program?.rewardDays ?? 7)} Premium за каждого друга, который оплатил подписку; дни начисляются после проверки ({program?.holdDays ?? 14} {plural(program?.holdDays ?? 14, 'день', 'дня', 'дней')}). Друг засчитывается, когда его приложение Raid OS на ПК привязало аккаунт Escape from Tarkov: один аккаунт игры — один друг. Любой возврат оплаты друга отменяет его дни и бонус ранга, если друзей для ранга больше не хватает. Награды — дни Premium, деньгами не выводятся. Накрутка аннулирует награды.
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
    { icon: UserPlus, label: 'Зарегистрировались', value: program.invited, meta: 'по вашему коду' },
    { icon: CreditCard, label: 'Оплатили', value: program.paid, meta: 'первую подписку' },
    { icon: ShieldCheck, label: 'Подтверждено', value: program.confirmed, meta: 'после проверки' },
  ]
  return (
    <>
      <div className="ref-top" style={{ marginBottom: 0 }}>
        <div className="field">
          <span className="field-label">Ваш код</span>
          <div className="copy-row"><code data-testid="invite-code">{program.code}</code><CopyButton value={program.code} /></div>
        </div>
        <div className="field">
          <span className="field-label"><Link2 size={12} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 5 }} />Ссылка для друга</span>
          <div className="copy-row"><code title={link}>{link}</code><CopyButton value={link} /></div>
        </div>
      </div>
      {program.invited === 0 && <ChangeCode code={program.code} onChange={onChange} />}

      <div className="stat-grid ref-stats">
        {counters.map(({ icon: Icon, label, value, meta }) => (
          <div key={label} className="stat-card">
            <div className="stat-label"><Icon aria-hidden="true" />{label}</div>
            <div className="stat-value mono">{numberFormat.format(value)}</div>
            <div className="stat-meta">{meta}</div>
          </div>
        ))}
      </div>

      <div className="invite-progress">
        <div className="invite-progress-head">
          <span className="invite-progress-text">{progressText(program)}</span>
          {program.next && <span className="mono dim">{numberFormat.format(program.confirmed)} / {numberFormat.format(program.next.friends)}</span>}
        </div>
        <div className="invite-bar" role="progressbar" aria-label="Прогресс до следующего ранга" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
          <span style={{ transform: `scaleX(${share})` }} />
        </div>
        {waiting > 0 && <span className="field-hint">Ещё {waiting} {plural(waiting, 'оплата', 'оплаты', 'оплат')} на проверке — засчитаются после {program.holdDays} {plural(program.holdDays, 'дня', 'дней', 'дней')}.</span>}
      </div>

      <RankLadder ranks={ranks} confirmed={program.confirmed} rewardDays={program.rewardDays} />

      <div className="invite-rewards">
        <div className="field-label">Награды</div>
        {program.rewards.length === 0 ? (
          <div className="muted" style={{ fontSize: 14 }}>Пока наград нет. Поделитесь ссылкой — как только друг оплатит подписку, здесь появится {bonusText(program.rewardDays)} Premium.</div>
        ) : (
          <ul className="reward-list">
            {program.rewards.map((reward) => {
              const status = REWARD_STATUS[reward.status] ?? { label: reward.status, tone: '' }
              return (
                <li key={reward.id} className="reward-item">
                  <div className="reward-main">
                    <strong>{rewardTitle(reward, ranks)}</strong>
                    <span className="dim mono">{createdFormat.format(new Date(reward.createdAt))} · {rewardDaysText(reward.days)}</span>
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
    if (!REFERRAL_CODE_PATTERN.test(normalized)) { setError('Код: 3–24 символа, латиница, цифры, «_» или «-».'); return }
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
        <button type="button" className="button ghost small" onClick={() => { setValue(code); setError(null); setOpen(true) }}><Pencil aria-hidden="true" />Изменить код</button>
        <span className="field-hint">Сменить код можно, пока по нему никто не зарегистрировался.</span>
      </div>
    )
  }
  return (
    <form className="invite-change" onSubmit={save} style={{ display: 'grid', gap: 8 }}>
      <div className="inline-form">
        <input className="input code" aria-label="Новый код" value={value} maxLength={24} spellCheck={false} autoComplete="off" placeholder="RAID-ARTEM" onChange={(e) => setValue(e.target.value.toUpperCase())} />
        <button type="submit" className="button primary" disabled={busy || value.trim().length < 3}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}Сохранить</button>
        <button type="button" className="button ghost" disabled={busy} onClick={() => setOpen(false)}><X aria-hidden="true" />Отмена</button>
      </div>
      <span className="field-hint">3–24 символа: латиница, цифры, «_» или «-». Старый код перестанет работать.</span>
      {error && <Notice tone="error">{error}</Notice>}
    </form>
  )
}
