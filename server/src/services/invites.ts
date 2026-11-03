/**
 * «Пригласи друга» — the referral program for ordinary players (streamers keep their money program, payoutStore.ts).
 *
 * Every player has a personal code (`accounts.invite_code`, «RAID-7K2QF» by default, can be changed once while nobody
 * has used it yet). A new player who registers with it (or enters it in the cabinet before their first payment) gets
 * FRIEND_DISCOUNT_PERCENT off the first month (PaymentStore.create). The player who invited them gets nothing for the
 * registration itself — only for a REAL paying friend, whether or not the inviter has ever paid (owner, 12.10.2026:
 * «ему дают бонусы, даже если он не оплатил первично»):
 *
 *   - the friend's first successful payment creates a reward of REWARD_DAYS days, «на проверке» for HOLD_MS — 3 days (owner, 20.10.2026: «автовыдачу через 3 дня»; refunds
 *     and charge-backs surface in that time, and the owner can cancel it); the owner's approval does not shorten it.
 *     Only a first payment made with the friend's discount counts (owner, 12.10.2026: «друзья должны оплатить подписку
 *     по скидке 20%») — the first month at FRIEND_DISCOUNT_PERCENT off; a friend who starts with a longer plan (no
 *     discount there) earns the inviter nothing;
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
import { AccountError, normalizeReferralCode, storedNickname, type AccountStore } from './accountStore.js'
import { transaction } from './database.js'
import { providerOf, type PaymentProvider, type PaymentStore, type SucceededPayment } from './paymentStore.js'

const DAY_MS = 24 * 60 * 60 * 1000
export const FRIEND_DISCOUNT_PERCENT = 20
export const REWARD_DAYS = 7
export const HOLD_MS = 3 * DAY_MS
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

/** «Привлечение друзей»: most friends first, most paying friends, most reward days, or the latest invitation. */
export type ReferralSort = 'invited' | 'paid' | 'days' | 'recent'

/** One account of «Привлечение друзей» (the owner's statistics of the program, InviteProgram.adminReferrals). */
export interface ReferrerStats {
  id: string
  /** Absent once the account is deleted. */
  email?: string
  nickname?: string
  code?: string
  /** Became a streamer after bringing friends as a player. */
  streamer?: true
  deleted?: true
  blocked?: true
  /** Registered with the code, deleted accounts included. */
  invited: number
  /** Of them with a payment that went through (and was not returned). */
  paid: number
  /** Registered and never paid, or every payment came back. */
  unpaid: number
  /** Of the invited, deleted their account since. */
  friendsDeleted: number
  lastInvitedAt?: string
  /** Friends with a granted reward: what the rank counts. */
  confirmed: number
  rank?: { id: RankId; title: string }
  /** Days of Premium: granted, on hold (granted when the hold is over), waiting for the owner's decision. */
  days: { granted: number; pending: number; review: number }
  /** Rank Legend granted: Premium for life. */
  lifetime?: true
  rewards: Record<RewardStatus, number>
  /** Rewards on hold whose friend has not bound a game account in the desktop app yet: they wait for it. */
  waitingEft: number
  /** The earliest moment a reward on hold can be granted. */
  nextReleaseAt?: string
}

/** A reward as «Привлечение друзей» shows it: its state, why it is held or refused, who decided. */
export type ReferralReward = RewardView & { flags: string[]; comment?: string; decidedBy?: string }

/** One friend of an inviter in «Привлечение друзей» (InviteProgram.adminReferrer). */
export interface ReferralFriend {
  id: string
  /** Absent once the friend deleted his account (`deleted`). */
  email?: string
  nickname?: string
  deleted?: true
  blocked?: true
  invitedAt: string
  paid: boolean
  /** Payments that went through. */
  payments: number
  /** Roubles of those payments. */
  amount: number
  /** Paid once, the money went back. */
  refunded?: true
  /** His desktop app has bound his Escape from Tarkov account. */
  eftBound: boolean
  first?: { amount: number; plan: string; provider: PaymentProvider; status: string; discountPercent?: number; paidAt?: string }
  reward?: ReferralReward
}

const lastInvited = (stats: ReferrerStats) => (stats.lastInvitedAt ? Date.parse(stats.lastInvitedAt) : 0)
function byReferralSort(sort: ReferralSort) {
  const then = (left: ReferrerStats, right: ReferrerStats) => right.invited - left.invited || right.paid - left.paid || lastInvited(right) - lastInvited(left)
  if (sort === 'paid') return (left: ReferrerStats, right: ReferrerStats) => right.paid - left.paid || then(left, right)
  if (sort === 'days') return (left: ReferrerStats, right: ReferrerStats) => right.days.granted + right.days.pending - left.days.granted - left.days.pending || then(left, right)
  if (sort === 'recent') return (left: ReferrerStats, right: ReferrerStats) => lastInvited(right) - lastInvited(left) || then(left, right)
  return then
}

/**
 * The owner's reward rows: both accounts with e-mail and game nickname (a deleted friend keeps only an anonymous stub,
 * AccountStore.deleteAccount) and the friend's payment — amount, status, provider (NULL = ЮKassa), plan, discount, paid.
 */
const ADMIN_SELECT = `SELECT r.*, i.email AS inviter_email, i.invite_code AS inviter_code, i.nicknames AS inviter_nicknames, i.deleted_at AS inviter_deleted_at,
  f.email AS friend_email, f.nicknames AS friend_nicknames, f.deleted_at AS friend_deleted_at,
  p.amount AS payment_amount, p.status AS payment_status, p.provider AS payment_provider, p.plan AS payment_plan,
  p.discount_percent AS payment_discount, p.paid_at AS payment_paid_at
  FROM invite_rewards r JOIN accounts i ON i.id = r.inviter_id LEFT JOIN accounts f ON f.id = r.friend_id LEFT JOIN payments p ON p.id = r.payment_id`

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

  /** Discount on the first month for a friend's invitation, %, or 0. */
  discountPercent(accountId: string) {
    // An account that came with a friend's code or a streamer's link (owner, 30.10.2026: «по этой ссылке у них скидка 20%…
    // на первый месяц» — before, 09.10.2026, a streamer's code gave no discount); a plain sign-up pays the list price.
    const referred = this.accounts.invitedBy(accountId) || this.accounts.billingInfo(accountId).referredBy
    return referred && !this.payments.friendDiscountUsed(accountId) ? FRIEND_DISCOUNT_PERCENT : 0
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

  /** The friend's first payment, made with the friend's discount: a reward for the inviter, on hold or for the owner's review. */
  private paymentSucceeded(payment: SucceededPayment) {
    const inviter = this.accounts.invitedBy(payment.accountId)
    if (!inviter || !payment.discountPercent) return
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
   * clears a friend's reward for the hourly release — never before its hold (HOLD_MS, 3 days since 20.10.2026) is over (refunds come in that time).
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
    const rows = this.db.prepare(`${ADMIN_SELECT} ${where}
      ORDER BY CASE r.status WHEN 'review' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as Row[]
    const counts = Object.fromEntries((this.db.prepare('SELECT status, COUNT(*) AS n FROM invite_rewards GROUP BY status').all() as Row[]).map((row) => [String(row.status), Number(row.n)]))
    return { rewards: rows.map((row) => this.toAdmin(row)), total, counts }
  }

  private adminReward(id: number) {
    const row = this.db.prepare(`${ADMIN_SELECT} WHERE r.id = ?`).get(id) as Row
    return this.toAdmin(row)
  }

  private toAdmin(row: Row) {
    const inviterNickname = row.inviter_deleted_at == null ? storedNickname(row.inviter_nicknames) : undefined
    const friendNickname = row.friend_deleted_at == null ? storedNickname(row.friend_nicknames) : undefined
    const provider = providerOf(row.payment_provider)
    return {
      ...this.toView(row),
      inviterId: String(row.inviter_id),
      inviter: String(row.inviter_email),
      ...(row.inviter_deleted_at == null ? {} : { inviterDeleted: true as const }),
      ...(inviterNickname ? { inviterNickname } : {}),
      ...(row.inviter_code == null ? {} : { inviterCode: String(row.inviter_code) }),
      ...(row.friend_id == null ? {} : { friendId: String(row.friend_id) }),
      ...(row.friend_deleted_at != null ? { friendDeleted: true as const } : row.friend_email == null ? {} : { friend: String(row.friend_email) }),
      ...(friendNickname ? { friendNickname } : {}),
      ...(row.payment_amount == null ? {} : {
        payment: {
          amount: Number(row.payment_amount) / 100,
          status: String(row.payment_status),
          provider,
          plan: String(row.payment_plan),
          ...(row.payment_discount == null ? {} : { discountPercent: Number(row.payment_discount) }),
          ...(row.payment_paid_at == null ? {} : { paidAt: new Date(Number(row.payment_paid_at)).toISOString() }),
        },
      }),
      flags: row.flags == null ? [] : String(row.flags).split(',').filter(Boolean),
      ...(row.decided_by == null ? {} : { decidedBy: String(row.decided_by) }),
      ...(row.comment == null ? {} : { comment: String(row.comment) }),
    }
  }

  /**
   * «Привлечение друзей» (owner, 03.11.2026: «список тех, кто привел друзей… сколько оплатили, сколько зарегистрировались
   * но не оплатили… сколько дней им положено, сколько через сколько будет выдано, и выдано ли»): every account that
   * brought friends — its counts and reward days — and the totals of the program. `q` narrows the list (e-mail, code,
   * nickname), never the totals.
   */
  adminReferrals(filter: { q?: string; sort?: ReferralSort } = {}) {
    const byId = new Map<string, ReferrerStats>()
    const entry = (id: string) => {
      let stats = byId.get(id)
      if (!stats) {
        stats = { id, invited: 0, paid: 0, unpaid: 0, friendsDeleted: 0, confirmed: 0, days: { granted: 0, pending: 0, review: 0 }, rewards: { pending: 0, review: 0, granted: 0, canceled: 0 }, waitingEft: 0 }
        byId.set(id, stats)
      }
      return stats
    }
    for (const row of this.db.prepare(`SELECT a.invited_by AS inviter, COUNT(*) AS invited, SUM(a.deleted_at IS NOT NULL) AS deleted,
        SUM(EXISTS (SELECT 1 FROM payments p WHERE p.account_id = a.id AND p.status = 'succeeded')) AS paid, MAX(COALESCE(a.invited_at, a.created_at)) AS last_at
      FROM accounts a WHERE a.invited_by IS NOT NULL GROUP BY a.invited_by`).all() as Row[]) {
      const stats = entry(String(row.inviter))
      stats.invited = Number(row.invited)
      stats.paid = Number(row.paid)
      stats.unpaid = stats.invited - stats.paid
      stats.friendsDeleted = Number(row.deleted)
      if (row.last_at != null) stats.lastInvitedAt = new Date(Number(row.last_at)).toISOString()
    }
    for (const row of this.db.prepare(`SELECT r.inviter_id AS inviter, r.kind, r.status, r.days, r.release_at,
        (r.kind = 'friend' AND r.status = 'pending' AND NOT EXISTS (SELECT 1 FROM eft_accounts e WHERE e.account_id = r.friend_id)) AS waiting
      FROM invite_rewards r`).all() as Row[]) {
      const stats = entry(String(row.inviter))
      const status = String(row.status) as RewardStatus
      stats.rewards[status] = (stats.rewards[status] ?? 0) + 1
      if (status === 'granted' || status === 'pending' || status === 'review') stats.days[status] += Number(row.days)
      if (row.kind === 'friend' && status === 'granted') stats.confirmed += 1
      if (row.kind === 'legend' && status === 'granted') stats.lifetime = true
      // A reward waiting for the friend's app has no date of its own: it goes at the first release after the binding.
      if (Number(row.waiting)) stats.waitingEft += 1
      else if (status === 'pending' && row.release_at != null && (!stats.nextReleaseAt || Number(row.release_at) < Date.parse(stats.nextReleaseAt))) stats.nextReleaseAt = new Date(Number(row.release_at)).toISOString()
    }
    for (const row of this.db.prepare(`SELECT id, email, kind, invite_code, nicknames, deleted_at, blocked_at FROM accounts
      WHERE id IN (SELECT invited_by FROM accounts WHERE invited_by IS NOT NULL UNION SELECT inviter_id FROM invite_rewards)`).all() as Row[]) {
      const stats = byId.get(String(row.id))
      if (!stats) continue
      const nickname = row.deleted_at == null ? storedNickname(row.nicknames) : undefined
      if (row.deleted_at == null) stats.email = String(row.email)
      else stats.deleted = true
      if (nickname) stats.nickname = nickname
      if (row.invite_code != null) stats.code = String(row.invite_code)
      if (row.kind === 'streamer') stats.streamer = true
      if (row.blocked_at != null) stats.blocked = true
      const rank = [...RANKS].reverse().find((item) => stats.confirmed >= item.friends)
      if (rank) stats.rank = { id: rank.id, title: rank.title }
    }
    const all = [...byId.values()]
    const sum = (pick: (stats: ReferrerStats) => number) => all.reduce((total, stats) => total + pick(stats), 0)
    const withFriends = all.filter((stats) => stats.invited > 0)
    const top = [...withFriends].sort(byReferralSort('invited'))[0]
    const summary = {
      /** Players who have opened «Пригласи друга» (their code exists). */
      withCode: Number((this.db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE kind = 'user' AND invite_code IS NOT NULL AND deleted_at IS NULL").get() as Row).n),
      referrers: withFriends.length,
      invited: sum((stats) => stats.invited),
      paid: sum((stats) => stats.paid),
      unpaid: sum((stats) => stats.unpaid),
      friendsDeleted: sum((stats) => stats.friendsDeleted),
      ...(top ? { top: { id: top.id, invited: top.invited, ...(top.email ? { email: top.email } : {}), ...(top.nickname ? { nickname: top.nickname } : {}) } } : {}),
      days: { granted: sum((stats) => stats.days.granted), pending: sum((stats) => stats.days.pending), review: sum((stats) => stats.days.review) },
      rewards: { pending: sum((stats) => stats.rewards.pending), review: sum((stats) => stats.rewards.review), granted: sum((stats) => stats.rewards.granted), canceled: sum((stats) => stats.rewards.canceled) },
      waitingEft: sum((stats) => stats.waitingEft),
      lifetime: all.filter((stats) => stats.lifetime).length,
      rewardDays: REWARD_DAYS,
      holdDays: Math.round(HOLD_MS / DAY_MS),
      discountPercent: FRIEND_DISCOUNT_PERCENT,
      ranks: RANKS,
    }
    const q = filter.q?.trim().toLowerCase()
    const referrers = (q ? all.filter((stats) => [stats.email, stats.code, stats.nickname].some((value) => value?.toLowerCase().includes(q))) : all)
      .sort(byReferralSort(filter.sort ?? 'invited'))
    return { summary, referrers, total: referrers.length }
  }

  /**
   * One account of «Привлечение друзей»: every friend it brought — when, paid or not and how, whether his game account
   * is bound — with the reward for him, and its other rewards (the ranks). 404 for an account that brought nobody.
   */
  adminReferrer(inviterId: string) {
    const referrer = this.adminReferrals().referrers.find((stats) => stats.id === inviterId)
    if (!referrer) throw new AccountError(404, 'Этот аккаунт никого не приглашал')
    const iso = (value: unknown) => new Date(Number(value)).toISOString()
    const listed = new Set<number>()
    const friends = (this.db.prepare(`SELECT a.id, a.email, a.nicknames, a.deleted_at, a.blocked_at, COALESCE(a.invited_at, a.created_at) AS invited_at,
        EXISTS (SELECT 1 FROM eft_accounts e WHERE e.account_id = a.id) AS eft_bound,
        (SELECT COUNT(*) FROM payments p WHERE p.account_id = a.id AND p.status = 'succeeded') AS paid_count,
        (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.account_id = a.id AND p.status = 'succeeded') AS paid_amount,
        (SELECT COUNT(*) FROM payments p WHERE p.account_id = a.id AND p.status = 'refunded') AS refunded_count
      FROM accounts a WHERE a.invited_by = ? ORDER BY invited_at DESC, a.rowid DESC`).all(inviterId) as Row[]).map((row): ReferralFriend => {
      const friendId = String(row.id)
      const deleted = row.deleted_at != null
      const nickname = deleted ? undefined : storedNickname(row.nicknames)
      const paidCount = Number(row.paid_count)
      const first = this.db.prepare("SELECT amount, plan, provider, discount_percent, paid_at, status FROM payments WHERE account_id = ? AND status IN ('succeeded', 'refunded') ORDER BY COALESCE(paid_at, created_at), rowid LIMIT 1").get(friendId) as Row | undefined
      const reward = this.db.prepare("SELECT r.*, NULL AS friend_email FROM invite_rewards r WHERE r.inviter_id = ? AND r.kind = 'friend' AND r.friend_id = ?").get(inviterId, friendId) as Row | undefined
      if (reward) listed.add(Number(reward.id))
      return {
        id: friendId,
        ...(deleted ? { deleted: true as const } : { email: String(row.email) }),
        ...(nickname ? { nickname } : {}),
        ...(row.blocked_at == null ? {} : { blocked: true as const }),
        invitedAt: iso(row.invited_at),
        paid: paidCount > 0,
        payments: paidCount,
        /** Roubles of the payments that went through. */
        amount: Number(row.paid_amount) / 100,
        ...(paidCount === 0 && Number(row.refunded_count) > 0 ? { refunded: true as const } : {}),
        eftBound: Boolean(Number(row.eft_bound)),
        ...(first ? {
          first: {
            amount: Number(first.amount) / 100,
            plan: String(first.plan),
            provider: providerOf(first.provider),
            status: String(first.status),
            ...(first.discount_percent == null ? {} : { discountPercent: Number(first.discount_percent) }),
            ...(first.paid_at == null ? {} : { paidAt: iso(first.paid_at) }),
          },
        } : {}),
        ...(reward ? { reward: this.rewardDetails(reward, !Number(row.eft_bound)) } : {}),
      }
    })
    // The ranks, and a friend's reward whose friend is not on the list any more.
    const rewards = (this.db.prepare('SELECT r.*, NULL AS friend_email FROM invite_rewards r WHERE r.inviter_id = ? ORDER BY r.created_at, r.id').all(inviterId) as Row[])
      .filter((row) => !listed.has(Number(row.id)))
      .map((row) => this.rewardDetails(row, false))
    return { referrer, friends, rewards }
  }

  /** A reward as «Привлечение друзей» shows it: its state, why it is held or refused, and whether it waits for the friend's app. */
  private rewardDetails(row: Row, friendUnbound: boolean): ReferralReward {
    return {
      ...this.toView(row),
      flags: row.flags == null ? [] : String(row.flags).split(',').filter(Boolean),
      ...(row.comment == null ? {} : { comment: String(row.comment) }),
      ...(row.decided_by == null ? {} : { decidedBy: String(row.decided_by) }),
      ...(row.kind === 'friend' && row.status === 'pending' && friendUnbound ? { waitingEft: true as const } : {}),
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
      ...(row.kind === 'friend' && row.friend_email != null && row.friend_deleted_at == null && !String(row.friend_email).endsWith('@deleted.invalid') ? { friend: maskEmail(String(row.friend_email)) } : {}),
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
    // Added days start after a free period still running too (PaymentStore.periodStart); taken back from the paid period.
    const until = days >= 0 ? this.payments.periodStart(accountId) + days * DAY_MS : Math.max(this.now(), current + days * DAY_MS)
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
