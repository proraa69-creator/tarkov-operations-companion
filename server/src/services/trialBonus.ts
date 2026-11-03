import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.js'
import { trialBonusNoticeTexts } from './grantNotice.js'
import type { NoticeStore } from './noticeStore.js'

const DAY_MS = 24 * 60 * 60 * 1000

/** An ordinary working account whose free period was never refused. */
const ORDINARY = "a.kind = 'user' AND a.deleted_at IS NULL AND a.blocked_at IS NULL AND a.trial_denied IS NULL"
/** Never paid: no payment that went through, refunded or not (a grant by hand is not a payment). */
const NEVER_PAID = "NOT EXISTS (SELECT 1 FROM payments p WHERE p.account_id = a.id AND p.status IN ('succeeded', 'refunded'))"

/**
 * The one-time free days (owner, 02.11.2026: «добавь всем пользователям у кого сейчас пробный период или кончился, по 2 дня
 * пробного… только тем кто не оплатил добавь дни, все те кто оплатили им не нужно добавлять»). Every account whose free
 * period has started — running or over — and that never paid gets `days` more after whatever it has running (its free
 * period, days granted by hand), each with the popup «Вам зачислено 2 дня пробного периода»; a free period still waiting
 * for the first sign-in in an app is brought up to `pendingMs`, the new length (AccountStore WELCOME_TRIAL_MS). Run once,
 * on the server (src/cli/trialBonus.ts); `dryRun` only counts.
 */
export function grantTrialBonus(db: DatabaseSync, notices: Pick<NoticeStore, 'personal'> | undefined, options: { now: number; days: number; pendingMs: number; dryRun?: boolean }) {
  const started = db.prepare(`SELECT a.id, a.trial_ends_at, COALESCE((SELECT s.paid_until FROM subscriptions s WHERE s.account_id = a.id), 0) AS paid_until
    FROM accounts a WHERE ${ORDINARY} AND a.trial_ends_at IS NOT NULL AND ${NEVER_PAID}`).all() as Array<{ id: string; trial_ends_at: number; paid_until: number }>
  const waiting = `${ORDINARY} AND a.trial_ends_at IS NULL AND a.trial_pending_ms IS NOT NULL AND a.trial_pending_ms < ? AND ${NEVER_PAID}`
  const pending = Number((db.prepare(`SELECT COUNT(*) AS n FROM accounts a WHERE ${waiting}`).get(options.pendingMs) as { n: number }).n)
  if (options.dryRun) return { bonus: started.length, pending, dryRun: true as const }
  transaction(db, () => {
    const extend = db.prepare('UPDATE accounts SET trial_ends_at = ? WHERE id = ?')
    for (const row of started) extend.run(Math.max(options.now, Number(row.paid_until), Number(row.trial_ends_at)) + options.days * DAY_MS, row.id)
    db.prepare(`UPDATE accounts SET trial_pending_ms = ? WHERE id IN (SELECT a.id FROM accounts a WHERE ${waiting})`).run(options.pendingMs, options.pendingMs)
  })
  for (const row of started) notices?.personal(row.id, trialBonusNoticeTexts(options.days))
  return { bonus: started.length, pending, dryRun: false as const }
}
