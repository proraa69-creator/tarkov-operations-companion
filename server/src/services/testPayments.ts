/**
 * Tests only: records a succeeded payment straight in the database, the way a payment provider's confirmation would
 * (no provider is connected now). The referred user's streamer gets the share in force for their code, and the plan's
 * months are added to the paid period.
 */
import { randomBytes } from 'node:crypto'
import { PLAN_MONTHS, type PaymentStore, type PlanId } from './paymentStore.js'

const MONTH_MS = 30 * 24 * 60 * 60 * 1000

export function recordPayment(payments: PaymentStore, accountId: string, plan: PlanId, rub: number, options: { now?: number; provider?: string } = {}) {
  const db = payments.database
  const now = options.now ?? Date.now()
  const referral = (db.prepare('SELECT referred_by FROM accounts WHERE id = ?').get(accountId) as { referred_by: string | null } | undefined)?.referred_by ?? null
  const amount = Math.round(rub * 100)
  const percent = referral === null ? null : payments.percentFor(referral)
  const id = randomBytes(12).toString('hex')
  db.prepare("INSERT INTO payments (id, account_id, plan, amount, status, referral_code, created_at, paid_at, provider, currency, amount_original, streamer_percent, streamer_earning) VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?, ?, 'RUB', ?, ?, ?)")
    .run(id, accountId, plan, amount, referral, now, now, options.provider ?? 'test', amount, percent, percent === null ? null : Math.floor(amount * percent / 100))
  const until = Math.max(now, payments.paidUntil(accountId) ?? 0) + PLAN_MONTHS[plan] * MONTH_MS
  db.prepare('INSERT INTO subscriptions (account_id, paid_until) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET paid_until = excluded.paid_until').run(accountId, until)
  return id
}
