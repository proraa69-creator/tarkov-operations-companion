/**
 * «Пригласи друга» — the referral program for ordinary players (streamers keep their money program, payoutStore.ts).
 *
 * Every player has a personal code (`accounts.invite_code`, «RAID-7K2QF» by default, can be changed once while nobody
 * has used it yet). A new player who registers with it (or enters it in the cabinet before their first payment) gets
 * FRIEND_DISCOUNT_PERCENT off the first month (PaymentStore.create). The player who invited them gets nothing for the
 * registration itself — only for a REAL paying friend:
 *
 *   - the friend's first successful payment creates a reward of REWARD_DAYS days, «на проверке» for HOLD_MS (refunds
 *     and charge-backs surface in that time, and the owner can cancel it); the owner's approval does not shorten it;
 *   - a friend counts once per Escape from Tarkov account: the reward waits until the friend's desktop app has bound
 *     his game account (AccountStore.bindEftAccount), and a game account counted once never counts again (eft_counted
 *     survives account deletion);
 *   - ANY refund of the friend's payment, full or partial, cancels the reward — taking the days back if already granted —
 *     and the rank bonuses the inviter no longer has enough confirmed friends for (owner's decision 08.10.2026, «А»);
 *   - suspicious rewards (same device, same registration address, same card as the inviter or as another friend, too
 *     many in a day) go to the owner's review instead and are never granted automatically;
 *   - after the hold `release()` (hourly, index.ts) grants the days — only while the friend's payment is still
 *     succeeded and the inviter's account works — and the milestones: 3 / 10 / 25 confirmed friends add a month /
 *     three months / a year, 50 make Premium lifelong (rank «Legend»).
 *
 * Rewards are subscription days only: they are never paid out. Ranks follow the number of confirmed friends.
 */
import { randomInt } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { AccountError, normalizeReferralCode, type AccountStore } from './accountStore.js'
import { transaction } from './database.js'
import type { PaymentStore, SucceededPayment } from './paymentStore.js'

const DAY_MS = 24 * 60 * 60 * 1000
export const FRIEND_DISCOUNT_PERCENT = 20
export const REWARD_DAYS = 7
export const HOLD_MS = 14 * DAY_MS
/** Paid until this moment means «навсегда» (rank Legend). */
export const LIFETIME_UNTIL = Date.UTC(2100, 0, 1)
/** More new rewards than this for one inviter within a day go to the owner's review. */
const BURST_LIMIT = 5
/** This many invited friends registered from one address go to the owner's review. */
const SAME_ADDRESS_LIMIT = 3

export type RankId = 'scout' | 'operator' | 'squad-leader' | 'raid-commander' | 'legend'
export const RANKS: Array<{ id: RankId; title: string; friends: number; bonusDays: number | 'lifetime' }> = [
  { id: 'scout', title: 'Scout', friends: 1, bonusDays: 0 },
  { id: 'operator', title: 'Operator', friends: 3, bonusDays: 30 },
  { id: 'squad-leader', title: 'Squad Leader', friends: 10, bonusDays: 90 },
  { id: 'raid-commander', title: 'Raid Commander', friends: 25, bonusDays: 365 },
  { id: 'legend', title: 'Legend', friends: 50, bonusDays: 'lifetime' },
]

export type RewardStatus = 'pending' | 'review' | 'granted' | 'canceled'
export type FraudFlag = 'same-device' | 'same-address' | 'address-cluster' | 'same-card' | 'card-reused' | 'burst' | 'same-email' | 'eft-counted'
/** Milestones big enough to be worth faking friends for: granted only after the owner's review. */
const REVIEWED_MILESTONES = new Set<RankId>(['raid-commander', 'legend'])
export interface RewardView {
  id: number
  kind: 'friend' | RankId
  /** Days of Premium, or «lifetime». */
  days: number | 'lifetime'
  status: RewardStatus
  createdAt: string
  /** When a pending reward is granted at the earliest. */
  releaseAt?: string
  decidedAt?: string
  /** The friend's e-mail, masked (a***@mail.ru); absent for milestones. */
  friend?: string
  /** On hold and the friend has not bound his Escape from Tarkov account yet (the reward waits for it). */
  waitingEft?: true
}

type Row = Record<string, unknown>

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS invite_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inviter_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    friend_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    payment_id TEXT,
    kind TEXT NOT NULL,
    days INTEGER NOT NULL,
    status TEXT NOT NULL,
    flags TEXT,
    created_at INTEGER NOT NULL,
    release_at INTEGER,
    decided_at INTEGER,
    decided_by TEXT,
    comment TEXT);
  CREATE INDEX IF NOT EXISTS invite_rewards_inviter ON invite_rewards(inviter_id, created_at);
  CREATE INDEX IF NOT EXISTS invite_rewards_status ON invite_rewards(status, release_at);
  CREATE UNIQUE INDEX IF NOT EXISTS invite_rewards_friend ON invite_rewards(friend_id) WHERE kind = 'friend' AND friend_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS invite_rewards_milestone ON invite_rewards(inviter_id, kind) WHERE kind != 'friend';
  -- Game accounts (AccountStore eft digest) already counted as a friend once: kept after account deletion.
  CREATE TABLE IF NOT EXISTS invite_eft_counted (
    eft_digest TEXT PRIMARY KEY,
    reward_id INTEGER,
    counted_at INTEGER NOT NULL);
`
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE = /^[A-Z0-9_-]{3,24}$/

/** One mailbox under its aliases: case, Gmail dots and «+tags» (a.b+1@gmail.com = ab@gmail.com). */
function normalizeEmail(email: string) {
  const [rawName = '', rawDomain = ''] = email.trim().toLowerCase().split('@')
  const domain = rawDomain === 'googlemail.com' ? 'gmail.com' : rawDomain
  let name = rawName.split('+')[0] ?? ''
  if (domain === 'gmail.com') name = name.replace(/\./g, '')
  return name && domain ? `${name}@${domain}` : ''
}

const maskEmail = (email: string) => {
  const [name = '', domain = ''] = email.split('@')
  return `${name.slice(0, 1)}***@${domain}`
}

export class InviteProgram {
  private readonly db: DatabaseSync
  private readonly now: () => number

  constructor(private readonly accounts: AccountStore, private readonly payments: PaymentStore, options: { now?: () => number } = {}) {
    if (accounts.database !== payments.database) throw new Error('InviteProgram: accounts and payments must share one database')
    this.db = accounts.database
    this.now = options.now ?? Date.now
    this.db.exec(SCHEMA)
    // The paid period before «навсегда» (rank Legend), to give it back if the rank is lost. Added to older databases.
    const columns = new Set((this.db.prepare('PRAGMA table_info(invite_rewards)').all() as Row[]).map((row) => String(row.name)))
    if (!columns.has('previous_until')) this.db.exec('ALTER TABLE invite_rewards ADD COLUMN previous_until INTEGER')
    payments.onSucceeded((payment) => this.paymentSucceeded(payment))
    payments.onRefunded((payment) => this.paymentRefunded(payment.id, payment.partial === true))
  }

  /** Discount on the first month for either a player or streamer invitation, %, or 0. */
  discountPercent(accountId: string) {
    const account = this.accounts.view(accountId)
    return (this.accounts.invitedBy(accountId) || account.referredBy) && !this.payments.hasSucceeded(accountId) ? FRIEND_DISCOUNT_PERCENT : 0
  }

  /** The player's code, created on first use. Streamers have their own program. */
  code(accountId: string) {
    const row = this.mustPlayer(accountId)
    if (row.invite_code != null) return String(row.invite_code)
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = `RAID-${Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')}`
      if (this.accounts.holderOfCode(code)) continue
      try {
        this.db.prepare('UPDATE accounts SET invite_code = ? WHERE id = ? AND invite_code IS NULL').run(code, accountId)
        return String((this.db.prepare('SELECT invite_code FROM accounts WHERE id = ?').get(accountId) as Row).invite_code)
      } catch { /* taken meanwhile: next attempt */ }
    }
    throw new AccountError(503, 'Не удалось создать код. Попробуйте ещё раз.')
  }

  /** «RAID-ARTEM», «SHAURMA10»: a code of one's own, while no friend has used the current one yet. */
  setCode(accountId: string, rawCode: string) {
    this.mustPlayer(accountId)
    const code = normalizeReferralCode(rawCode)
    if (!CODE.test(code)) throw new AccountError(400, 'Код: 3–24 символа, латиница, цифры, «_» или «-»')
    if (this.invitedCount(accountId) > 0) throw new AccountError(409, 'По вашему коду уже зарегистрировались друзья — сменить его нельзя')
    const holder = this.accounts.holderOfCode(code)
    if (holder && holder !== accountId) throw new AccountError(409, 'Этот код уже занят')
    try {
      this.db.prepare('UPDATE accounts SET invite_code = ? WHERE id = ?').run(code, accountId)
    } catch {
      throw new AccountError(409, 'Этот код уже занят')
    }
    return this.program(accountId)
  }

  /** Everything the cabinet shows: the code, counters, rank, next rank and the rewards. */
  program(accountId: string) {
    const code = this.code(accountId)
    const confirmed = this.confirmedCount(accountId)
    const rank = [...RANKS].reverse().find((item) => confirmed >= item.friends)
    const next = RANKS.find((item) => confirmed < item.friends)
    const count = (sql: string) => Number((this.db.prepare(sql).get(accountId) as Row).n)
    const rewards = (this.db.prepare('SELECT r.*, a.email AS friend_email FROM invite_rewards r LEFT JOIN accounts a ON a.id = r.friend_id WHERE r.inviter_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 100').all(accountId) as Row[])
      .map((row) => {
        const view = this.toView(row)
        if (row.kind === 'friend' && row.status === 'pending' && (row.friend_id == null || !this.accounts.eftDigestOf(String(row.friend_id)))) view.waitingEft = true
        return view
      })
    return {
      code,
      discountPercent: FRIEND_DISCOUNT_PERCENT,
      rewardDays: REWARD_DAYS,
      holdDays: Math.round(HOLD_MS / DAY_MS),
      invited: this.invitedCount(accountId),
      paid: count("SELECT COUNT(*) AS n FROM invite_rewards WHERE inviter_id = ? AND kind = 'friend' AND status IN ('pending', 'review', 'granted')"),
      confirmed,
      rank: rank ? { id: rank.id, title: rank.title } : null,
      next: next ? { id: next.id, title: next.title, friends: next.friends, bonusDays: next.bonusDays } : null,
      ranks: RANKS,
      rewards,
    }
  }

  /** The friend's first payment: a reward for the inviter, on hold or for the owner's review. */
  private paymentSucceeded(payment: SucceededPayment) {
    const inviter = this.accounts.invitedBy(payment.accountId)
    if (!inviter) return
    const first = this.db.prepare("SELECT COUNT(*) AS n FROM payments WHERE account_id = ? AND status = 'succeeded'").get(payment.accountId) as Row
    if (Number(first.n) !== 1) return
    const flags = this.fraudFlags(inviter, payment)
    const now = this.now()
    this.db.prepare("INSERT INTO invite_rewards (inviter_id, friend_id, payment_id, kind, days, status, flags, created_at, release_at) VALUES (?, ?, ?, 'friend', ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
      .run(inviter, payment.accountId, payment.id, REWARD_DAYS, flags.length ? 'review' : 'pending', flags.length ? flags.join(',') : null, now, now + HOLD_MS)
  }

  /**
   * Any refund of the friend's payment, full or partial: a reward on hold / under review is dropped; one already granted
   * is cancelled and its days are taken back from the inviter (never below now), with the rank bonuses he no longer has
   * enough confirmed friends for.
   */
  private paymentRefunded(paymentId: string, partial = false) {
    const row = this.db.prepare("SELECT * FROM invite_rewards WHERE payment_id = ? AND kind = 'friend' AND status != 'canceled'").get(paymentId) as Row | undefined
    if (!row) return
    this.db.prepare("UPDATE invite_rewards SET status = 'canceled', decided_at = ?, comment = ? WHERE id = ?")
      .run(this.now(), partial ? 'платёж друга частично возвращён' : 'платёж друга возвращён', Number(row.id))
    if (row.status !== 'granted') return
    this.extend(String(row.inviter_id), -Number(row.days))
    this.revokeLostMilestones(String(row.inviter_id))
  }

  /** Rank bonuses above the inviter's confirmed friends now: cancelled, their days taken back (never below now). */
  private revokeLostMilestones(inviter: string) {
    const confirmed = this.confirmedCount(inviter)
    for (const rank of RANKS) {
      if (rank.bonusDays === 0 || confirmed >= rank.friends) continue
      const row = this.db.prepare("SELECT * FROM invite_rewards WHERE inviter_id = ? AND kind = ? AND status != 'canceled'").get(inviter, rank.id) as Row | undefined
      if (!row) continue
      this.db.prepare("UPDATE invite_rewards SET status = 'canceled', decided_at = ?, comment = 'ранг потерян: платёж друга возвращён' WHERE id = ?").run(this.now(), Number(row.id))
      if (row.status !== 'granted') continue
      if (rank.bonusDays === 'lifetime') {
        // Back to the end the paid period had before «навсегда» (previous_until, stored at grant), never below now.
        this.db.prepare('UPDATE subscriptions SET paid_until = ? WHERE account_id = ?').run(Math.max(this.now(), Number(row.previous_until ?? 0)), inviter)
      } else this.extend(inviter, -Number(row.days))
    }
  }

  private fraudFlags(inviter: string, payment: SucceededPayment): FraudFlag[] {
    const flags: FraudFlag[] = []
    const friend = payment.accountId
    const emails = this.db.prepare('SELECT id, email FROM accounts WHERE id IN (?, ?)').all(inviter, friend) as Row[]
    const email = (id: string) => normalizeEmail(String(emails.find((row) => row.id === id)?.email ?? ''))
    if (email(friend) && email(friend) === email(inviter)) flags.push('same-email')
    const has = (table: string) => this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined
    if (has('account_devices') && this.db.prepare('SELECT 1 FROM account_devices a JOIN account_devices b ON a.device_id = b.device_id WHERE a.account_id = ? AND b.account_id = ?').get(inviter, friend)) flags.push('same-device')
    const addresses = this.db.prepare('SELECT id, signup_ip FROM accounts WHERE id IN (?, ?)').all(inviter, friend) as Row[]
    const address = (id: string) => addresses.find((row) => row.id === id)?.signup_ip
    const friendAddress = address(friend)
    if (friendAddress != null && friendAddress === address(inviter)) flags.push('same-address')
    if (friendAddress != null && Number((this.db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE invited_by = ? AND signup_ip = ?').get(inviter, String(friendAddress)) as Row).n) >= SAME_ADDRESS_LIMIT) flags.push('address-cluster')
    if (payment.methodKey) {
      if (this.db.prepare("SELECT 1 FROM payments WHERE account_id = ? AND method_key = ? AND status = 'succeeded'").get(inviter, payment.methodKey)) flags.push('same-card')
      if (this.db.prepare("SELECT 1 FROM invite_rewards r JOIN payments p ON p.id = r.payment_id WHERE r.inviter_id = ? AND r.kind = 'friend' AND r.status != 'canceled' AND p.method_key = ?").get(inviter, payment.methodKey)) flags.push('card-reused')
    }
    if (Number((this.db.prepare("SELECT COUNT(*) AS n FROM invite_rewards WHERE inviter_id = ? AND kind = 'friend' AND created_at > ?").get(inviter, this.now() - DAY_MS) as Row).n) >= BURST_LIMIT) flags.push('burst')
    return flags
  }

  /**
   * Hourly: grants the pending rewards whose hold is over — if the friend's payment is still succeeded and the inviter's
   * account works (otherwise the reward goes to the owner's review) — and then the milestones that became due.
   */
  release() {
    const due = this.db.prepare("SELECT r.*, p.status AS payment_status, a.blocked_at AS blocked_at, a.deleted_at AS deleted_at FROM invite_rewards r LEFT JOIN payments p ON p.id = r.payment_id JOIN accounts a ON a.id = r.inviter_id WHERE r.status = 'pending' AND r.release_at <= ?").all(this.now()) as Row[]
    let granted = 0
    for (const row of due) {
      transaction(this.db, () => {
        if (row.payment_status !== 'succeeded' || row.blocked_at != null || row.deleted_at != null) {
          this.db.prepare("UPDATE invite_rewards SET status = 'review', flags = COALESCE(flags || ',', '') || 'payment-or-account' WHERE id = ? AND status = 'pending'").run(Number(row.id))
          return
        }
        if (row.kind === 'friend') {
          const eft = row.friend_id == null ? undefined : this.accounts.eftDigestOf(String(row.friend_id))
          // No game account bound yet: the reward waits (it is granted at the first release after the binding).
          if (!eft) return
          if (eft === this.accounts.eftDigestOf(String(row.inviter_id)) || this.db.prepare('SELECT 1 FROM invite_eft_counted WHERE eft_digest = ?').get(eft)) {
            this.db.prepare("UPDATE invite_rewards SET status = 'review', flags = COALESCE(flags || ',', '') || 'eft-counted' WHERE id = ? AND status = 'pending'").run(Number(row.id))
            return
          }
          if (!this.grant(Number(row.id), String(row.inviter_id), Number(row.days))) return
          this.db.prepare('INSERT OR IGNORE INTO invite_eft_counted (eft_digest, reward_id, counted_at) VALUES (?, ?, ?)').run(eft, Number(row.id), this.now())
          granted++
        } else if (this.grant(Number(row.id), String(row.inviter_id), Number(row.days))) granted++
        this.grantMilestones(String(row.inviter_id))
      })
    }
    return { granted }
  }

  /**
   * The owner's decision on a reward under review or on hold: «cancel» drops it; «approve» grants a milestone now and
   * clears a friend's reward for the hourly release — never before its 14 days are over (refunds come in that time).
   */
  decide(actor: string, id: number, decision: 'approve' | 'cancel', comment?: string) {
    const row = this.db.prepare('SELECT * FROM invite_rewards WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new AccountError(404, 'Начисление не найдено')
    if (row.status !== 'pending' && row.status !== 'review') throw new AccountError(409, 'Решение по этому начислению уже принято')
    transaction(this.db, () => {
      if (decision === 'cancel') {
        this.db.prepare("UPDATE invite_rewards SET status = 'canceled', decided_at = ?, decided_by = ?, comment = ? WHERE id = ?").run(this.now(), actor, comment ?? null, id)
        return
      }
      if (row.kind === 'friend') {
        // Approved: back on hold without the suspicion flags; release() grants it when the hold is over (and the friend's
        // game account is bound and new).
        this.db.prepare("UPDATE invite_rewards SET status = 'pending', flags = NULL, decided_by = ?, comment = COALESCE(?, comment), release_at = MAX(COALESCE(release_at, 0), ?) WHERE id = ?")
          .run(actor, comment ?? null, Number(row.created_at) + HOLD_MS, id)
        return
      }
      if (row.kind === 'legend') {
        const changed = this.db.prepare("UPDATE invite_rewards SET status = 'granted', decided_at = ?, decided_by = ?, comment = COALESCE(?, comment), previous_until = ? WHERE id = ? AND status IN ('pending', 'review')").run(this.now(), actor, comment ?? null, this.payments.paidUntil(String(row.inviter_id)) ?? null, id)
        if (Number(changed.changes)) this.db.prepare('INSERT INTO subscriptions (account_id, paid_until) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET paid_until = MAX(paid_until, excluded.paid_until)').run(String(row.inviter_id), LIFETIME_UNTIL)
        return
      }
      this.grant(id, String(row.inviter_id), Number(row.days), actor, comment)
    })
    // An approved friend whose hold is already over is granted right away (outside the decision's transaction).
    if (decision === 'approve' && row.kind === 'friend') this.release()
    return this.adminReward(id)
  }

  /** The owner's list: under review first, then on hold, then the rest (newest first). */
  adminList(status: RewardStatus | undefined, limit: number, offset: number) {
    const where = status ? 'WHERE r.status = ?' : ''
    const args = status ? [status] : []
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM invite_rewards r ${where}`).get(...args) as Row).n)
    const rows = this.db.prepare(`SELECT r.*, i.email AS inviter_email, i.invite_code AS inviter_code, f.email AS friend_email, p.amount AS payment_amount, p.status AS payment_status FROM invite_rewards r JOIN accounts i ON i.id = r.inviter_id LEFT JOIN accounts f ON f.id = r.friend_id LEFT JOIN payments p ON p.id = r.payment_id ${where}
      ORDER BY CASE r.status WHEN 'review' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as Row[]
    const counts = Object.fromEntries((this.db.prepare('SELECT status, COUNT(*) AS n FROM invite_rewards GROUP BY status').all() as Row[]).map((row) => [String(row.status), Number(row.n)]))
    return { rewards: rows.map((row) => this.toAdmin(row)), total, counts }
  }

  private adminReward(id: number) {
    const row = this.db.prepare('SELECT r.*, i.email AS inviter_email, i.invite_code AS inviter_code, f.email AS friend_email, p.amount AS payment_amount, p.status AS payment_status FROM invite_rewards r JOIN accounts i ON i.id = r.inviter_id LEFT JOIN accounts f ON f.id = r.friend_id LEFT JOIN payments p ON p.id = r.payment_id WHERE r.id = ?').get(id) as Row
    return this.toAdmin(row)
  }

  private toAdmin(row: Row) {
    return {
      ...this.toView(row),
      inviter: String(row.inviter_email),
      ...(row.inviter_code == null ? {} : { inviterCode: String(row.inviter_code) }),
      ...(row.friend_email == null ? {} : { friend: String(row.friend_email) }),
      ...(row.payment_amount == null ? {} : { payment: { amount: Number(row.payment_amount) / 100, status: String(row.payment_status) } }),
      flags: row.flags == null ? [] : String(row.flags).split(',').filter(Boolean),
      ...(row.decided_by == null ? {} : { decidedBy: String(row.decided_by) }),
      ...(row.comment == null ? {} : { comment: String(row.comment) }),
    }
  }

  private toView(row: Row): RewardView {
    const iso = (value: unknown) => new Date(Number(value)).toISOString()
    return {
      id: Number(row.id),
      kind: String(row.kind) as RewardView['kind'],
      days: row.kind === 'legend' ? 'lifetime' : Number(row.days),
      status: String(row.status) as RewardStatus,
      createdAt: iso(row.created_at),
      ...(row.status === 'pending' && row.release_at != null ? { releaseAt: iso(row.release_at) } : {}),
      ...(row.decided_at == null ? {} : { decidedAt: iso(row.decided_at) }),
      ...(row.kind === 'friend' && row.friend_email != null && !String(row.friend_email).endsWith('@deleted.invalid') ? { friend: maskEmail(String(row.friend_email)) } : {}),
    }
  }

  /** pending/review → granted, adding the days to the inviter's paid period (from its end if it still runs). */
  private grant(id: number, inviter: string, days: number, actor?: string, comment?: string) {
    const changed = this.db.prepare("UPDATE invite_rewards SET status = 'granted', decided_at = ?, decided_by = ?, comment = COALESCE(?, comment) WHERE id = ? AND status IN ('pending', 'review')").run(this.now(), actor ?? null, comment ?? null, id)
    if (!Number(changed.changes)) return false
    this.extend(inviter, days)
    return true
  }

  private grantMilestones(inviter: string) {
    const confirmed = this.confirmedCount(inviter)
    for (const rank of RANKS) {
      if (rank.bonusDays === 0 || confirmed < rank.friends) continue
      const lifetime = rank.bonusDays === 'lifetime'
      const days = lifetime ? 0 : Number(rank.bonusDays)
      const reviewed = REVIEWED_MILESTONES.has(rank.id)
      // A rank lost after a refund and reached again: the same row comes back (one row per rank and inviter).
      const lost = this.db.prepare("SELECT id FROM invite_rewards WHERE inviter_id = ? AND kind = ? AND status = 'canceled'").get(inviter, rank.id) as Row | undefined
      // A year and lifetime Premium wait for the owner (decide): 25–50 paid «friends» is what a farm of alts would buy.
      if (reviewed) {
        if (lost) this.db.prepare("UPDATE invite_rewards SET status = 'review', flags = 'milestone', decided_at = NULL, decided_by = NULL, created_at = ? WHERE id = ?").run(this.now(), Number(lost.id))
        else this.db.prepare("INSERT INTO invite_rewards (inviter_id, kind, days, status, flags, created_at) VALUES (?, ?, ?, 'review', 'milestone', ?) ON CONFLICT DO NOTHING").run(inviter, rank.id, days, this.now())
        continue
      }
      const previous = this.payments.paidUntil(inviter) ?? null
      const changed = lost
        ? this.db.prepare("UPDATE invite_rewards SET status = 'granted', decided_at = ?, comment = 'ранг получен снова', previous_until = ? WHERE id = ?").run(this.now(), previous, Number(lost.id))
        : this.db.prepare("INSERT INTO invite_rewards (inviter_id, kind, days, status, created_at, decided_at, previous_until) VALUES (?, ?, ?, 'granted', ?, ?, ?) ON CONFLICT DO NOTHING").run(inviter, rank.id, days, this.now(), this.now(), previous)
      if (!Number(changed.changes)) continue
      if (lifetime) this.db.prepare('INSERT INTO subscriptions (account_id, paid_until) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET paid_until = MAX(paid_until, excluded.paid_until)').run(inviter, LIFETIME_UNTIL)
      else this.extend(inviter, days)
    }
  }

  /** Adds (or with negative `days` takes back, never below now) days of the paid period. */
  private extend(accountId: string, days: number) {
    const current = this.payments.paidUntil(accountId) ?? 0
    const until = days >= 0 ? Math.max(this.now(), current) + days * DAY_MS : Math.max(this.now(), current + days * DAY_MS)
    this.db.prepare('INSERT INTO subscriptions (account_id, paid_until) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET paid_until = excluded.paid_until').run(accountId, Math.min(until, LIFETIME_UNTIL))
  }

  private confirmedCount(accountId: string) {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM invite_rewards WHERE inviter_id = ? AND kind = 'friend' AND status = 'granted'").get(accountId) as Row).n)
  }

  private invitedCount(accountId: string) {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE invited_by = ? AND deleted_at IS NULL').get(accountId) as Row).n)
  }

  private mustPlayer(accountId: string) {
    const row = this.db.prepare('SELECT kind, invite_code FROM accounts WHERE id = ? AND deleted_at IS NULL').get(accountId) as Row | undefined
    if (!row) throw new AccountError(404, 'Аккаунт не найден')
    if (row.kind !== 'user') throw new AccountError(403, 'У стримеров своя партнёрская программа')
    return row
  }
}
