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
 * - eft_dispute_cases (owner, 27.11.2026, «спор за игровой аккаунт»): an app device of one Raid OS account reported a game
 *   account another Raid OS account holds. The case shows both accounts (a deleted one by its mask, as above), whether each
 *   paid and when; the owner keeps it as it is, gives the binding to the disputing account or unbinds both
 *   (AccountStore.decideEftDispute). One open case per game account and disputing account.
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
  CREATE TABLE IF NOT EXISTS eft_dispute_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eft_digest TEXT NOT NULL,
    eft_hint TEXT NOT NULL,
    holder_id TEXT NOT NULL,
    disputer_id TEXT NOT NULL,
    device_id TEXT,
    holder_email_masked TEXT,
    disputer_email_masked TEXT,
    created_at INTEGER NOT NULL,
    seen_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    status_at INTEGER,
    decision TEXT,
    decided_at INTEGER);
  CREATE UNIQUE INDEX IF NOT EXISTS eft_dispute_cases_open ON eft_dispute_cases(eft_digest, disputer_id) WHERE status <> 'closed';
  CREATE INDEX IF NOT EXISTS eft_dispute_cases_status ON eft_dispute_cases(status, created_at);
  CREATE INDEX IF NOT EXISTS eft_dispute_cases_disputer ON eft_dispute_cases(disputer_id, status);
  CREATE INDEX IF NOT EXISTS eft_dispute_cases_holder ON eft_dispute_cases(holder_id);
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

/**
 * How a dispute closed: the owner's «Оставить привязку» (keep), «Отдать спорящему» (transfer), «Снять обе» (unbind), or by
 * itself — the disputing account bound the game account when it was free again (bound).
 */
export type EftDisputeDecision = 'keep' | 'transfer' | 'unbind' | 'bound'
export const EFT_DISPUTE_CHOICES = ['keep', 'transfer', 'unbind'] as const
export type EftDisputeChoice = typeof EFT_DISPUTE_CHOICES[number]
/** Open disputes one account may have at once: a few game accounts in one PC's logs happen, dozens are a flood. */
export const MAX_OPEN_DISPUTES = 3
/**
 * The app offers the game accounts of its logs in turn until one fits (src/account/eftAccountLink.ts): a report of the same
 * device this soon after takes back the untouched cases of its earlier reports — two players on one PC are no dispute.
 */
export const DISPUTE_SETTLE_MS = 2 * 60 * 1000

/** Paid, for the dispute (AccountStore.eftStanding): Premium now, or a payment with money in it. */
export interface EftStanding { paid: boolean; paidUntil?: string; payments: number; streamer?: true }

export interface EftDisputeAccount extends EftStanding {
  accountId: string
  /** The e-mail now (a live account), or its mask (a deleted one). */
  email: string | null
  deleted: boolean
  createdAt?: string
  /** Its game account now, masked, since when, and whether it is the disputed one. */
  bound?: { eft: string; at: string; disputed: boolean }
}

export interface EftDispute {
  id: number
  kind: 'dispute'
  /** The first report of the disputing account. */
  createdAt: string
  /** Its latest report. */
  seenAt: string
  status: EftCaseStatus
  decision?: EftDisputeDecision
  decidedAt?: string
  eft: string
  eftKey: string
  /** The account that held the game account at the latest report. */
  holder: EftDisputeAccount
  disputer: EftDisputeAccount
}

export interface EftDisputeRow { id: number; eftDigest: string; eftHint: string; holderId: string; disputerId: string; status: EftCaseStatus; decision?: EftDisputeDecision }

type Row = Record<string, unknown>
const iso = (value: unknown) => (value == null ? undefined : new Date(Number(value)).toISOString())
const statusOf = (value: unknown): EftCaseStatus => (EFT_CASE_STATUSES.includes(value as EftCaseStatus) ? value as EftCaseStatus : 'active')

/** «player@gmail.com» → «pl•••@gmail.com»; anything without «@» → «•••». */
export function maskEmail(email: string) {
  const at = email.lastIndexOf('@')
  if (at < 1) return '•••'
  return `${email.slice(0, Math.min(2, at))}•••${email.slice(at)}`
}

export class EftLedger {
  private readonly db: DatabaseSync
  private readonly now: () => number
  private readonly standing: (accountId: string) => EftStanding

  /** `standing`: whether an account paid (AccountStore.eftStanding), shown in the disputes. */
  constructor(db: DatabaseSync, now: () => number = Date.now, standing: (accountId: string) => EftStanding = () => ({ paid: false, payments: 0 })) {
    this.db = db
    this.now = now
    this.standing = standing
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
   * account of this game account was deleted, else undefined. `quiet`: the owner's own decision on a dispute — the
   * history only, no case.
   */
  bound(accountId: string, digest: string, hint: string, email: string, options: { quiet?: boolean } = {}) {
    const at = this.now()
    this.db.prepare(`INSERT INTO eft_account_history (eft_digest, eft_hint, account_id, email_masked, bound_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(eft_digest, account_id) DO UPDATE SET eft_hint = excluded.eft_hint, gone_at = NULL, gone_reason = NULL`).run(digest, hint, accountId, maskEmail(email), at)
    // the hint of rows filled from eft_trial_claims (they had none)
    this.db.prepare("UPDATE eft_account_history SET eft_hint = ? WHERE eft_digest = ? AND eft_hint = ''").run(hint, digest)
    if (options.quiet) return undefined
    // Only a deleted earlier account makes a case: the owner's own unbinding (a player's rebinding he did himself) stays in
    // the history without one.
    const earlier = this.db.prepare("SELECT 1 FROM eft_account_history WHERE eft_digest = ? AND account_id <> ? AND gone_reason = 'deleted' LIMIT 1").get(digest, accountId)
    if (!earlier) return undefined
    const inserted = this.db.prepare('INSERT OR IGNORE INTO eft_rebind_cases (eft_digest, eft_hint, account_id, created_at) VALUES (?, ?, ?, ?)').run(digest, hint, accountId, at)
    return Number(inserted.changes) > 0 ? Number(inserted.lastInsertRowid) : undefined
  }

  /** The account's game account left it: «Удалить аккаунт» (its e-mail is masked first) or the owner's unbinding. */
  gone(accountId: string, reason: 'deleted' | 'unbound', email?: string) {
    if (email) {
      this.db.prepare('UPDATE eft_account_history SET email_masked = ? WHERE account_id = ?').run(maskEmail(email), accountId)
      this.db.prepare('UPDATE eft_dispute_cases SET holder_email_masked = ? WHERE holder_id = ?').run(maskEmail(email), accountId)
      this.db.prepare('UPDATE eft_dispute_cases SET disputer_email_masked = ? WHERE disputer_id = ?').run(maskEmail(email), accountId)
    }
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

  /** New cases of both kinds: the owner's badge (app.ts). */
  activeCount() {
    return this.counts().active + this.disputeCounts().active
  }

  /**
   * The report of `disputerId`'s app device names a game account `holderId` holds (AccountStore.noteEftDispute): opens a
   * case, or notes the report on the open one. None again for a pair the owner left as it is while the same account holds
   * the game account, nor beyond MAX_OPEN_DISPUTES. The untouched cases of this device's reports a moment ago for other game
   * accounts go first (DISPUTE_SETTLE_MS). `opened`: the new case.
   */
  disputed(digest: string, hint: string, holderId: string, disputerId: string, deviceId: string): { opened?: number; withdrawn: number } {
    const at = this.now()
    const withdrawn = this.withdraw(disputerId, deviceId, digest)
    const open = this.db.prepare("SELECT id FROM eft_dispute_cases WHERE eft_digest = ? AND disputer_id = ? AND status <> 'closed'").get(digest, disputerId) as Row | undefined
    if (open) {
      this.db.prepare('UPDATE eft_dispute_cases SET seen_at = ?, holder_id = ?, eft_hint = ?, device_id = ? WHERE id = ?').run(at, holderId, hint, deviceId, Number(open.id))
      return { withdrawn }
    }
    const kept = this.db.prepare("SELECT id FROM eft_dispute_cases WHERE eft_digest = ? AND disputer_id = ? AND holder_id = ? AND status = 'closed' AND decision = 'keep' ORDER BY id DESC LIMIT 1").get(digest, disputerId, holderId) as Row | undefined
    if (kept) {
      this.db.prepare('UPDATE eft_dispute_cases SET seen_at = ? WHERE id = ?').run(at, Number(kept.id))
      return { withdrawn }
    }
    const openCount = Number((this.db.prepare("SELECT COUNT(*) AS n FROM eft_dispute_cases WHERE disputer_id = ? AND status <> 'closed'").get(disputerId) as Row).n)
    if (openCount >= MAX_OPEN_DISPUTES) return { withdrawn }
    const inserted = this.db.prepare('INSERT INTO eft_dispute_cases (eft_digest, eft_hint, holder_id, disputer_id, device_id, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(digest, hint, holderId, disputerId, deviceId, at, at)
    return { opened: Number(inserted.lastInsertRowid), withdrawn }
  }

  /** The untouched cases this device opened in the last DISPUTE_SETTLE_MS, but for the game account `except`: they go. */
  withdraw(disputerId: string, deviceId: string, except?: string) {
    const extra = except === undefined ? '' : ' AND eft_digest <> ?'
    return Number(this.db.prepare(`DELETE FROM eft_dispute_cases WHERE disputer_id = ? AND device_id = ? AND created_at >= ? AND status = 'active' AND status_at IS NULL AND decision IS NULL${extra}`)
      .run(disputerId, deviceId, this.now() - DISPUTE_SETTLE_MS, ...(except === undefined ? [] : [except])).changes)
  }

  /** The disputing account bound the game account itself (it was free again): its open case closes by itself. */
  boundBy(accountId: string, digest: string) {
    const at = this.now()
    return Number(this.db.prepare("UPDATE eft_dispute_cases SET status = 'closed', status_at = ?, decision = 'bound', decided_at = ? WHERE eft_digest = ? AND disputer_id = ? AND status <> 'closed'")
      .run(at, at, digest, accountId).changes)
  }

  disputeRow(id: number): EftDisputeRow | undefined {
    const row = this.db.prepare('SELECT * FROM eft_dispute_cases WHERE id = ?').get(id) as Row | undefined
    if (!row) return undefined
    return {
      id: Number(row.id), eftDigest: String(row.eft_digest), eftHint: String(row.eft_hint), holderId: String(row.holder_id), disputerId: String(row.disputer_id),
      status: statusOf(row.status), ...(row.decision != null ? { decision: String(row.decision) as EftDisputeDecision } : {}),
    }
  }

  /** «Взять» / «Вернуть» of an open case. */
  moveDispute(id: number, status: 'active' | 'working') {
    return Number(this.db.prepare("UPDATE eft_dispute_cases SET status = ?, status_at = ? WHERE id = ? AND status <> 'closed'").run(status, this.now(), id).changes) > 0
  }

  /** «Вернуть» of a case left as it is; false while the pair has another open case. */
  reopenDispute(id: number) {
    const row = this.db.prepare("SELECT eft_digest, disputer_id FROM eft_dispute_cases WHERE id = ? AND status = 'closed' AND decision = 'keep'").get(id) as Row | undefined
    if (!row) return false
    if (this.db.prepare("SELECT 1 FROM eft_dispute_cases WHERE eft_digest = ? AND disputer_id = ? AND status <> 'closed'").get(String(row.eft_digest), String(row.disputer_id))) return false
    return Number(this.db.prepare("UPDATE eft_dispute_cases SET status = 'active', status_at = ?, decision = NULL, decided_at = NULL WHERE id = ?").run(this.now(), id).changes) > 0
  }

  /** The owner's decision (AccountStore.decideEftDispute) closes the case. */
  closeDispute(id: number, decision: EftDisputeDecision) {
    const at = this.now()
    return Number(this.db.prepare("UPDATE eft_dispute_cases SET status = 'closed', status_at = ?, decision = ?, decided_at = ? WHERE id = ? AND status <> 'closed'").run(at, decision, at, id).changes) > 0
  }

  /** The game account went to `holderId` by the owner's decision: its other open cases name the new holder. */
  retarget(digest: string, holderId: string, exceptId: number) {
    this.db.prepare("UPDATE eft_dispute_cases SET holder_id = ? WHERE eft_digest = ? AND status <> 'closed' AND id <> ? AND disputer_id <> ?").run(holderId, digest, exceptId, holderId)
  }

  disputeCounts() {
    const counts: Record<EftCaseStatus, number> = { active: 0, working: 0, closed: 0 }
    for (const row of this.db.prepare('SELECT status, COUNT(*) AS n FROM eft_dispute_cases GROUP BY status').all() as Row[]) {
      if (EFT_CASE_STATUSES.includes(row.status as EftCaseStatus)) counts[row.status as EftCaseStatus] = Number(row.n)
    }
    return counts
  }

  listDisputes(status: EftCaseStatus, limit = 50, offset = 0) {
    const rows = this.db.prepare('SELECT * FROM eft_dispute_cases WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').all(status, limit, offset) as Row[]
    return { rows: rows.map((row) => this.disputeView(row)), counts: this.disputeCounts() }
  }

  getDispute(id: number) {
    const row = this.db.prepare('SELECT * FROM eft_dispute_cases WHERE id = ?').get(id) as Row | undefined
    return row ? this.disputeView(row) : undefined
  }

  private disputeAccount(accountId: string, masked: unknown, digest: string): EftDisputeAccount {
    const live = this.db.prepare('SELECT email, created_at, deleted_at FROM accounts WHERE id = ?').get(accountId) as Row | undefined
    const deleted = !live || live.deleted_at != null
    const own = deleted ? undefined : this.db.prepare('SELECT eft_digest, eft_hint, bound_at FROM eft_accounts WHERE account_id = ?').get(accountId) as Row | undefined
    return {
      accountId,
      email: deleted ? (masked == null ? null : String(masked)) : String(live!.email),
      deleted,
      ...(live?.created_at != null ? { createdAt: iso(live.created_at)! } : {}),
      ...(deleted ? { paid: false, payments: 0 } : this.standing(accountId)),
      ...(own ? { bound: { eft: `••••${String(own.eft_hint)}`, at: iso(own.bound_at)!, disputed: String(own.eft_digest) === digest } } : {}),
    }
  }

  private disputeView(row: Row): EftDispute {
    const digest = String(row.eft_digest)
    return {
      id: Number(row.id),
      kind: 'dispute',
      createdAt: iso(row.created_at)!,
      seenAt: iso(row.seen_at)!,
      status: statusOf(row.status),
      ...(row.decision != null ? { decision: String(row.decision) as EftDisputeDecision } : {}),
      ...(row.decided_at != null ? { decidedAt: iso(row.decided_at)! } : {}),
      eft: `••••${String(row.eft_hint)}`,
      eftKey: digest.slice(0, 8),
      holder: this.disputeAccount(String(row.holder_id), row.holder_email_masked, digest),
      disputer: this.disputeAccount(String(row.disputer_id), row.disputer_email_masked, digest),
    }
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
