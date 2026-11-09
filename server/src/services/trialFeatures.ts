import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

/**
 * Functions the owner turns on for one account for a while, ending by themselves (owner, 31.10.2026: «добавь только ему
 * на 1 день такую функцию. после этого она отключится сама»). The first ones were written here, accounts named by the
 * SHA-256 of their lowercase e-mail, so no address is kept in the source; since 01.11.2026 the owner turns them on
 * himself in «Админ панель» → «Функции» (owner: «ввожу его почту и нажимаю включить поиск по экрану на сутки»), kept in
 * the database (TrialFeatureStore, routes/trialFeatures.ts).
 *
 * `questTableScan`: the app reads the game's «Задания» table from the screen even when the game's logs look complete
 * (src/components/StoryScreenScanner.tsx) — a player whose logs showed his finished quests and only 3 of his current ones.
 * `mapFloorWheel`: Alt + the mouse wheel steps the map's floors (src/maps/mapFloorWheel.tsx; owner, 08.11.2026: «добавь
 * этому человеку… по комбинации клавиш зажатия Alt и прокручивания ролика вверх-вниз… Только этому человеку… У остальных этой
 * функции не должно быть» — the author of the idea, report №55).
 */
export interface TrialFeatures { questTableScan: string | null; mapFloorWheel: string | null }

export type TrialFeature = keyof TrialFeatures

const TRIALS: Array<{ emailSha256: string; feature: TrialFeature; until: string }> = [
  { emailSha256: '1113b475e5bf253e2259ee7aed94afb3cf96e45b5328196da915c10b2eb1cd7e', feature: 'questTableScan', until: '2026-11-01T20:00:00.000Z' },
  // the author of report №55, with no end (owner, 08.11.2026)
  { emailSha256: '7e8fc65308ccbc36533f00cb486cd2ab26b77e1aebcd9a48624addd393549e29', feature: 'mapFloorWheel', until: '2100-01-01T00:00:00.000Z' },
]

const digest = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex')

/** The account's trial functions still on at `now`: each one's end, or null. `store`: the ones the owner turned on. */
export function trialFeatures(email: string | undefined, now = Date.now(), store?: TrialFeatureStore, accountId?: string): TrialFeatures {
  const features: TrialFeatures = { questTableScan: null, mapFloorWheel: null }
  if (email) {
    const own = digest(email)
    for (const trial of TRIALS) {
      if (trial.emailSha256 === own && Date.parse(trial.until) > now) features[trial.feature] = trial.until
    }
  }
  if (store && accountId) {
    for (const grant of store.activeFor(accountId, now)) {
      const kept = features[grant.feature]
      if (!kept || Date.parse(grant.until) > Date.parse(kept)) features[grant.feature] = grant.until
    }
  }
  return features
}

export interface TrialGrant { accountId: string; email: string; feature: TrialFeature; until: string; grantedBy: string; grantedAt: string }

interface Row { account_id: string; email: string; feature: string; until: string; granted_by: string; granted_at: string }

const grant = (row: Row): TrialGrant => ({ accountId: row.account_id, email: row.email, feature: row.feature as TrialFeature, until: row.until, grantedBy: row.granted_by, grantedAt: row.granted_at })

/** One row per account and function: its end. Turning it on again moves the end; turning it off ends it now. */
export class TrialFeatureStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS trial_features (
        account_id TEXT NOT NULL,
        email TEXT NOT NULL,
        feature TEXT NOT NULL,
        until TEXT NOT NULL,
        granted_by TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        PRIMARY KEY (account_id, feature));`)
  }

  /** On for `hours` from now (0: off now). */
  set(accountId: string, email: string, feature: TrialFeature, hours: number, actor: string): TrialGrant {
    const now = this.now()
    const row: Row = { account_id: accountId, email: email.trim().toLowerCase(), feature, until: new Date(now + hours * 3600_000).toISOString(), granted_by: actor, granted_at: new Date(now).toISOString() }
    this.db.prepare(`INSERT INTO trial_features (account_id, email, feature, until, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (account_id, feature) DO UPDATE SET email = excluded.email, until = excluded.until, granted_by = excluded.granted_by, granted_at = excluded.granted_at`)
      .run(row.account_id, row.email, row.feature, row.until, row.granted_by, row.granted_at)
    return grant(row)
  }

  activeFor(accountId: string, now = this.now()): TrialGrant[] {
    const rows = this.db.prepare('SELECT * FROM trial_features WHERE account_id = ?').all(accountId) as unknown as Row[]
    return rows.map(grant).filter((entry) => Date.parse(entry.until) > now)
  }

  /** Every function still on, the soonest end first. */
  active(now = this.now()): TrialGrant[] {
    const rows = this.db.prepare('SELECT * FROM trial_features ORDER BY until').all() as unknown as Row[]
    return rows.map(grant).filter((entry) => Date.parse(entry.until) > now)
  }
}
