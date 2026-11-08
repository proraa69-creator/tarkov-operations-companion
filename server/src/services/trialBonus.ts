import type { DatabaseSync } from 'node:sqlite'
import { TRIAL_RAID_WAIT_MS } from './accountStore.js'
import { transaction } from './database.js'
import { raidTrialBonusNoticeTexts, trialBonusNoticeTexts } from './grantNotice.js'
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

/**
 * What the game's logs leave on the server for an account (the PC app's reports): the game account, mode and level, quest
 * and progress records, the mirrors of the quests, the hideout and the stash, the position. Tables of other stores may be
 * missing in a database that never had them; `owner` columns hold «user:<account id>».
 */
const GAME_DATA: Array<[table: string, column: 'account_id' | 'owner']> = [
  ['eft_reports', 'account_id'], ['eft_accounts', 'account_id'], ['user_game_mode', 'account_id'], ['user_levels', 'account_id'],
  ['user_positions', 'account_id'], ['user_quest_mirror', 'account_id'], ['user_item_counts', 'account_id'], ['user_hideout', 'account_id'],
  ['quest_events', 'owner'], ['progress_events', 'owner'], ['objective_progress', 'owner'], ['story_records', 'owner'], ['progress_scopes', 'owner'],
]

/**
 * The one-time free days of 08.11.2026 (owner: «зарегистрированных, но не оплаченных, зашли в приложение, но не сходили ни
 * разу в рейд… выдать им ещё по 2 дня, но чтобы отсчёт начинался после начала первого рейда»): every ordinary account that
 * never paid, signed in to an app (a device) and has no game data on the server at all gets `days` that wait for the first
 * raid (AccountStore.waitForFirstRaid, firstRaid; TRIAL_RAID_WAIT_MS at most), each with the popup «Вам зачислено 2 дня
 * пробного периода. Отсчёт начнётся с первого рейда.». What is left of a free period still running waits with them. An
 * account whose days already wait for the first raid is left as it is. Run once, on the server (src/cli/raidTrialBonus.ts);
 * `dryRun` only counts.
 */
export function grantRaidTrialBonus(db: DatabaseSync, notices: Pick<NoticeStore, 'personal'> | undefined, options: { now: number; days: number; dryRun?: boolean }) {
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name))
  const noGameData = GAME_DATA.filter(([table]) => tables.has(table))
    .map(([table, column]) => `NOT EXISTS (SELECT 1 FROM ${table} g WHERE ${column === 'owner' ? "g.owner IN (a.id, 'user:' || a.id)" : 'g.account_id = a.id'})`)
  const rows = db.prepare(`SELECT a.id, a.trial_ends_at FROM accounts a WHERE ${ORDINARY} AND ${NEVER_PAID} AND a.trial_raid_ms IS NULL
    AND EXISTS (SELECT 1 FROM account_devices d WHERE d.account_id = a.id)${noGameData.map((clause) => ` AND ${clause}`).join('')}`).all() as Array<{ id: string; trial_ends_at: number | null }>
  if (options.dryRun) return { bonus: rows.length, dryRun: true as const }
  const waitUntil = options.now + TRIAL_RAID_WAIT_MS
  transaction(db, () => {
    const wait = db.prepare('UPDATE accounts SET trial_raid_ms = ?, trial_raid_wait_until = ?, trial_ends_at = ?, trial_pending_ms = NULL WHERE id = ? AND trial_raid_ms IS NULL')
    for (const row of rows) {
      const left = Math.max(0, Number(row.trial_ends_at ?? 0) - options.now)
      const ms = options.days * DAY_MS + left
      wait.run(ms, waitUntil, waitUntil + ms, row.id)
    }
  })
  for (const row of rows) notices?.personal(row.id, raidTrialBonusNoticeTexts(options.days))
  return { bonus: rows.length, dryRun: false as const }
}
