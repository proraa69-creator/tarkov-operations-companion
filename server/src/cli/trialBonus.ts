/**
 * The one-time free days of 02.11.2026 (services/trialBonus.ts) on the server's own database: without arguments it only
 * counts; `--apply` grants them, raises the waiting free periods and writes the owner's audit log. Run once, from the
 * server's folder, after the release that knows the personal popups (account_notices):
 *
 *   node --import tsx src/cli/trialBonus.ts [--apply]
 */
import { WELCOME_TRIAL_MS } from '../services/accountStore.js'
import { openDatabase, resolveDbPath } from '../services/database.js'
import { NoticeStore } from '../services/noticeStore.js'
import { grantTrialBonus } from '../services/trialBonus.js'

const apply = process.argv.includes('--apply')
const db = openDatabase(resolveDbPath())
const notices = new NoticeStore(db)
const now = Date.now()
const result = grantTrialBonus(db, apply ? notices : undefined, { now, days: 2, pendingMs: WELCOME_TRIAL_MS, dryRun: !apply })
if (apply) {
  db.prepare('INSERT INTO owner_audit_log (at, actor, action, target, details) VALUES (?, ?, ?, ?, ?)')
    .run(now, 'Claude (по просьбе владельца)', 'subscription.bulk-grant', null, JSON.stringify({ count: result.bonus, days: 2, reason: 'Пробный период: +2 дня всем, кто не платил', pendingRaised: result.pending }))
}
console.log(JSON.stringify(result))
db.close()
