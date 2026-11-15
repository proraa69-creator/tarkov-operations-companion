/**
 * «Аккаунты Таркова» (owner, 15.11.2026): which Raid OS accounts an Escape from Tarkov account was ever bound to, kept
 * after «Удалить аккаунт», and the cases where a game account comes back on a new Raid OS account after its old one was
 * deleted — «удаляет аккаунт, 10 дней проходит, создаёт новый и использует 2 бонусных дня…
 * присылай мне уведомление… какой первый аккаунт, какая почта, потом актуальный сейчас, номер Таркова».
 *
 * - eft_account_history: one row per (game account, Raid OS account), never purged and without a foreign key, like
 *   eft_trial_claims. The game account is its digest and last digits only (as eft_accounts); the e-mail of a deleted
 *   account is kept masked («pl•••@gmail.com»), never whole: deleting an account removes the personal data
 *   (AccountStore.deleteAccount, the privacy policy), and the mask is enough to recognise a repeat.
 * - eft_rebind_cases: a game account bound to a new account while an earlier account of it is gone. Shown in «Отчёты» →
 *   «Аккаунты Таркова» with the owner's statuses (active → working → closed). Whether the new account got free days again is
 *   shown too: one free period per game account (eft_trial_claims) normally refuses them.
 */
import type { DatabaseSync } from 'node:sqlite'

export const EFT_LEDGER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS eft_account_history (
    eft_digest TEXT NOT NULL,
    eft_hint TEXT NOT NULL,
    account_id TEXT NOT NULL,
    email_masked TEXT,
    bound_at INTEGER NOT NULL,
    gone_at INTEGER,
    gone_reason TEXT,
    PRIMARY KEY (eft_digest, account_id));
  CREATE INDEX IF NOT EXISTS eft_account_history_account ON eft_account_history(account_id);
  CREATE TABLE IF NOT EXISTS eft_rebind_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eft_digest TEXT NOT NULL,
    eft_hint TEXT NOT NULL,
    account_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    status_at INTEGER,
    UNIQUE (eft_digest, account_id));
`

export type EftCaseStatus = 'active' | 'working' | 'closed'
export const EFT_CASE_STATUSES: readonly EftCaseStatus[] = ['active', 'working', 'closed']

export interface EftCaseAccount {
  accountId: string
  /** The e-mail now (a live account), or its mask (a deleted one). */
  email: string | null
  deleted: boolean
  createdAt?: string
  boundAt: string
  goneAt?: string
  goneReason?: 'deleted' | 'unbound'
  /** Free days this account got: a trial claimed with this game account (eft_trial_claims). */
  trialByThisGame: boolean
}

export interface EftCase {
  id: number
  createdAt: string
  status: EftCaseStatus
  /** «••••323»: the last digits of the game account, as the app shows it. */
  eft: string
  /** The first 8 characters of the digest: the same game account across cases. */
  eftKey: string
  current: EftCaseAccount & { trialDenied: boolean }
  previous: EftCaseAccount[]
}

type Row = Record<string, unknown>
const iso = (value: unknown) => (value == null ? undefined : new Date(Number(value)).toISOString())

/** «player@gmail.com» → «pl•••@gmail.com»; anything without «@» → «•••». */
export function maskEmail(email: string) {
  const at = email.lastIndexOf('@')
  if (at < 1) return '•••'
  return `${email.slice(0, Math.min(2, at))}•••${email.slice(at)}`
}

export class EftLedger {
  private readonly db: DatabaseSync
  private readonly now: () => number

  constructor(db: DatabaseSync, now: () => number = Date.now) {
    this.db = db
    this.now = now
    this.db.exec(EFT_LEDGER_SCHEMA)
    this.backfill()
  }

  /**
   * Bindings from before the ledger: the current ones (eft_accounts) and the game accounts of deleted accounts that
   * claimed a free period (eft_trial_claims — the only trace a deleted account left of its game account). Runs on every
   * start; INSERT OR IGNORE keeps what is already there.
   */
  private backfill() {
    const has = (table: string) => this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined
    if (has('eft_accounts') && has('accounts')) {
      this.db.prepare(`INSERT OR IGNORE INTO eft_account_history (eft_digest, eft_hint, account_id, email_masked, bound_at)
        SELECT e.eft_digest, e.eft_hint, e.account_id, NULL, e.bound_at FROM eft_accounts e`).run()
    }
    if (has('eft_trial_claims') && has('accounts')) {
      this.db.prepare(`INSERT OR IGNORE INTO eft_account_history (eft_digest, eft_hint, account_id, email_masked, bound_at, gone_at, gone_reason)
        SELECT c.eft_digest, '', c.account_id, NULL, c.at, a.deleted_at, 'deleted' FROM eft_trial_claims c JOIN accounts a ON a.id = c.account_id WHERE a.deleted_at IS NOT NULL`).run()
    }
  }

  /**
   * A game account was just bound to `accountId` (AccountStore.bindEftAccount). Returns the new case when an earlier
   * account of this game account was deleted, else undefined.
   */
  bound(accountId: string, digest: string, hint: string, email: string) {
    const at = this.now()
    this.db.prepare(`INSERT INTO eft_account_history (eft_digest, eft_hint, account_id, email_masked, bound_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(eft_digest, account_id) DO UPDATE SET eft_hint = excluded.eft_hint, gone_at = NULL, gone_reason = NULL`).run(digest, hint, accountId, maskEmail(email), at)
    // the hint of rows filled from eft_trial_claims (they had none)
    this.db.prepare("UPDATE eft_account_history SET eft_hint = ? WHERE eft_digest = ? AND eft_hint = ''").run(hint, digest)
    // Only a deleted earlier account makes a case: the owner's own unbinding (a player's rebinding he did himself) stays in
    // the history without one.
    const earlier = this.db.prepare("SELECT 1 FROM eft_account_history WHERE eft_digest = ? AND account_id <> ? AND gone_reason = 'deleted' LIMIT 1").get(digest, accountId)
    if (!earlier) return undefined
    const inserted = this.db.prepare('INSERT OR IGNORE INTO eft_rebind_cases (eft_digest, eft_hint, account_id, created_at) VALUES (?, ?, ?, ?)').run(digest, hint, accountId, at)
    return Number(inserted.changes) > 0 ? Number(inserted.lastInsertRowid) : undefined
  }

  /** The account's game account left it: «Удалить аккаунт» (its e-mail is masked first) or the owner's unbinding. */
  gone(accountId: string, reason: 'deleted' | 'unbound', email?: string) {
    if (email) this.db.prepare('UPDATE eft_account_history SET email_masked = ? WHERE account_id = ?').run(maskEmail(email), accountId)
    // A deletion counts even after an unbinding (the account is gone for good); an unbinding never overrides a deletion.
    if (reason === 'deleted') this.db.prepare("UPDATE eft_account_history SET gone_at = COALESCE(gone_at, ?), gone_reason = 'deleted' WHERE account_id = ?").run(this.now(), accountId)
    else this.db.prepare("UPDATE eft_account_history SET gone_at = ?, gone_reason = 'unbound' WHERE account_id = ? AND gone_at IS NULL").run(this.now(), accountId)
  }

  counts() {
    const counts: Record<EftCaseStatus, number> = { active: 0, working: 0, closed: 0 }
    for (const row of this.db.prepare('SELECT status, COUNT(*) AS n FROM eft_rebind_cases GROUP BY status').all() as Row[]) {
      if (EFT_CASE_STATUSES.includes(row.status as EftCaseStatus)) counts[row.status as EftCaseStatus] = Number(row.n)
    }
    return counts
  }

  list(status: EftCaseStatus, limit = 50, offset = 0) {
    const rows = this.db.prepare('SELECT * FROM eft_rebind_cases WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(status, limit, offset) as Row[]
    return { rows: rows.map((row) => this.view(row)), counts: this.counts() }
  }

  get(id: number) {
    const row = this.db.prepare('SELECT * FROM eft_rebind_cases WHERE id = ?').get(id) as Row | undefined
    return row ? this.view(row) : undefined
  }

  setStatus(id: number, status: EftCaseStatus) {
    const changed = Number(this.db.prepare('UPDATE eft_rebind_cases SET status = ?, status_at = ? WHERE id = ?').run(status, this.now(), id).changes)
    return changed > 0 ? this.get(id) : undefined
  }

  private account(accountId: string, history: Row | undefined): EftCaseAccount {
    const live = this.db.prepare('SELECT email, created_at, deleted_at FROM accounts WHERE id = ?').get(accountId) as Row | undefined
    const deleted = !live || live.deleted_at != null
    const trial = this.db.prepare('SELECT 1 FROM eft_trial_claims WHERE account_id = ?').get(accountId) !== undefined
    return {
      accountId,
      email: deleted ? (history?.email_masked == null ? null : String(history.email_masked)) : String(live!.email),
      deleted,
      ...(live?.created_at != null ? { createdAt: iso(live.created_at)! } : {}),
      boundAt: iso(history?.bound_at ?? live?.created_at ?? 0)!,
      ...(history?.gone_at != null ? { goneAt: iso(history.gone_at)!, goneReason: history.gone_reason === 'unbound' ? 'unbound' as const : 'deleted' as const } : {}),
      trialByThisGame: trial,
    }
  }

  private view(row: Row): EftCase {
    const digest = String(row.eft_digest)
    const currentId = String(row.account_id)
    const history = this.db.prepare('SELECT * FROM eft_account_history WHERE eft_digest = ? ORDER BY bound_at, rowid').all(digest) as Row[]
    const own = history.find((entry) => String(entry.account_id) === currentId)
    const denied = this.db.prepare('SELECT trial_denied FROM accounts WHERE id = ?').get(currentId) as Row | undefined
    return {
      id: Number(row.id),
      createdAt: iso(row.created_at)!,
      status: EFT_CASE_STATUSES.includes(row.status as EftCaseStatus) ? row.status as EftCaseStatus : 'active',
      eft: `••••${String(row.eft_hint)}`,
      eftKey: digest.slice(0, 8),
      current: { ...this.account(currentId, own), trialDenied: denied?.trial_denied != null },
      previous: history.filter((entry) => String(entry.account_id) !== currentId).map((entry) => this.account(String(entry.account_id), entry)),
    }
  }
}
