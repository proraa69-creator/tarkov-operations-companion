import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { formatPeriodKey } from '../ReferralStatsTable'
import type { AdminInviter, AdminPayment } from '../../api'
import { usersLink } from './adminData'

/**
 * An account in plain words: the e-mail (a link to it in «Пользователи») and the game nickname, or «аккаунт удалён»
 * (owner, 17.10.2026: «от кого пришло, кто пришёл, аккаунты их»).
 */
export function AccountRef({ email, nickname, deleted }: { email?: string; nickname?: string; deleted?: boolean }) {
  if (deleted || !email) return <span className="admin-account is-deleted">аккаунт удалён</span>
  return (
    <span className="admin-account">
      <a className="admin-account-link" href={usersLink(email)} title="Открыть в «Пользователях»">{email}</a>
      {nickname && <span className="admin-nickname" title="Ник в Таркове"> · {nickname}</span>}
    </span>
  )
}

/** Who paid and where the payer came from: a friend's invitation (with the account), a streamer's code, or nobody. */
export function PaymentWho({ payment }: { payment: AdminPayment }) {
  const inviter: Pick<AdminInviter, 'email' | 'nickname' | 'deleted'> | undefined = payment.invitedBy
    ?? (payment.friendDiscount && (payment.friendDiscount.inviter || payment.friendDiscount.inviterDeleted)
      ? { email: payment.friendDiscount.inviter, ...(payment.friendDiscount.inviterDeleted ? { deleted: true as const } : {}) }
      : undefined)
  return (
    <div className="admin-who">
      <div className="admin-who-line"><span className="admin-who-label">Оплатил:</span> <AccountRef email={payment.email} nickname={payment.nickname} /></div>
      <div className="admin-who-line admin-origin">
        {inviter ? <><span className="admin-who-label">Пришёл по приглашению:</span> <AccountRef email={inviter.email} nickname={inviter.nickname} deleted={inviter.deleted} /></>
          : payment.friendDiscount ? <span className="admin-who-label">Пришёл по коду друга</span>
            : payment.referralCode ? <span className="admin-who-label">Пришёл по коду стримера <strong className="mono">{payment.referralCode}</strong></span>
              : <span className="admin-who-label dim">Пришёл без приглашения</span>}
        {payment.friendDiscount && <span className="tag green admin-mini" title="Оплачено со скидкой друга">скидка друга −{payment.friendDiscount.percent} %</span>}
      </div>
    </div>
  )
}

export function Loading({ text = 'Загружаем…' }: { text?: string }) {
  return <div className="muted admin-loading"><LoaderCircle className="spinner" size={14} aria-hidden="true" />{text}</div>
}

/**
 * A single-series column chart (oldest left). Thin columns with rounded tops on a recessive baseline grid; every
 * column has a hover / focus tooltip, and the numbers are always in the table next to it (the chart is a summary).
 */
export function ColumnChart<R extends { period: string }>({ title, rows, value, format, tone = 'brass' }: {
  title: string
  rows: R[]
  value: (row: R) => number
  format: (value: number) => string
  tone?: 'brass' | 'green'
}) {
  const [active, setActive] = useState<number | null>(null)
  const ordered = [...rows].reverse()
  const values = ordered.map((row) => value(row))
  const max = Math.max(...values, 0)
  const top = niceMax(max)
  const total = values.reduce((sum, item) => sum + item, 0)
  const hovered = active === null ? null : { row: ordered[active]!, value: values[active]! }
  return (
    <figure className={`admin-chart tone-${tone}`}>
      <figcaption>
        <span className="field-label">{title}</span>
        <span className="admin-chart-readout mono" aria-live="polite">
          {hovered ? <>{formatPeriodKey(hovered.row.period)}: <strong>{format(hovered.value)}</strong></> : <>Итого: <strong>{format(total)}</strong></>}
        </span>
      </figcaption>
      <div className="admin-chart-plot">
        <div className="admin-chart-axis mono" aria-hidden="true"><span>{format(top)}</span><span>{format(top / 2)}</span><span>0</span></div>
        <div className="admin-chart-bars" role="list" onMouseLeave={() => setActive(null)}>
          {ordered.map((row, index) => {
            const share = top > 0 ? values[index]! / top : 0
            return (
              <button
                key={row.period}
                type="button"
                role="listitem"
                className={`admin-chart-col${active === index ? ' is-active' : ''}`}
                aria-label={`${formatPeriodKey(row.period)}: ${format(values[index]!)}`}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              >
                <span className="admin-chart-bar" style={{ height: `${Math.max(share * 100, values[index]! > 0 ? 2 : 0)}%` }} />
              </button>
            )
          })}
        </div>
      </div>
      <div className="admin-chart-x mono" aria-hidden="true">
        <span>{ordered[0] ? formatPeriodKey(ordered[0].period) : ''}</span>
        <span>{ordered.length > 1 ? formatPeriodKey(ordered[ordered.length - 1]!.period) : ''}</span>
      </div>
    </figure>
  )
}

/** 1, 2, 2.5, 5 × 10^n at or above `value`, so the axis reads in round numbers. */
function niceMax(value: number) {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power
  return 10 * power
}
