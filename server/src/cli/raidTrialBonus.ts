/**
 * The one-time free days of 08.11.2026 (services/trialBonus.ts grantRaidTrialBonus) on the server's own database: two days
 * that start with the first raid, for the accounts that never paid, signed in to an app and never played with it. Without
 * arguments it only counts; `--apply` grants them and writes the owner's audit log. Run once, from the server's folder, as
 * the service user, after the release that knows the first raid (POST /v1/accounts/me/first-raid):
 *
 *   node --import tsx src/cli/raidTrialBonus.ts [--apply]
 */
import { openDatabase, resolveDbPath } from '../services/database.js'
import { NoticeStore } from '../services/noticeStore.js'
import { grantRaidTrialBonus } from '../services/trialBonus.js'

const apply = process.argv.includes('--apply')
const db = openDatabase(resolveDbPath())
const notices = new NoticeStore(db)
const now = Date.now()
const result = grantRaidTrialBonus(db, apply ? notices : undefined, { now, days: 2, dryRun: !apply })
if (apply) {
  db.prepare('INSERT INTO owner_audit_log (at, actor, action, target, details) VALUES (?, ?, ?, ?, ?)')
    .run(now, 'Claude (по просьбе владельца)', 'subscription.bulk-grant', null, JSON.stringify({ count: result.bonus, days: 2, reason: 'Пробный период: +2 дня с первого рейда тем, кто не играл с приложением' }))
}
console.log(JSON.stringify(result))
db.close()
