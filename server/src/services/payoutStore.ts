/**
 * Streamer payouts: a small ledger next to the payments (same SQLite database).
 *
 *   earned     — the streamer's stored share of every succeeded payment of users who came by his link
 *                (PaymentStore fixes the percent per payment when it succeeds, so later changes never rewrite history);
 *   paid out   — payout requests the owner marked «Выплачено»;
 *   pending    — requests waiting for the owner («Ожидает выплаты»);
 *   available  — earned − paid out − pending, never negative.
 *
 * The streamer requests any amount from the minimum up to the available balance, one open request at a time. Money is
 * NOT moved by the server: the owner transfers it (SBP by phone) and marks the request paid. Auto-payout was removed
 * (owner, 25.11.2026): the server never creates a request on its own, and old `auto` values trigger nothing.
 *
 * Payout details: only what a manual SBP transfer needs — recipient name, phone (СБП) and bank name, filled by the
 * streamer and saved. Card numbers are never accepted or stored (that would put the server under PCI DSS). The streamer
 * sees his phone masked; the owner sees the details in full to make the transfer.
 */
import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.js'
import { PAYOUT_MATURITY_DAYS } from '../../../src/shared/revenue'

type Row = Record<string, unknown>

/** Where earnings come from (PaymentStore). Amounts in kopecks. */
export interface EarningsSource {
  streamerEarned(code: string): number
  /** Earned share of referred payments paid at or before `maturedBefore` (ms): matured for payout (14-day rule). */
  streamerMatured(code: string, maturedBefore: number): number
  readonly streamerPercent: number
  /** The streamer's own percent when the owner set one (admin panel), else `streamerPercent`. */
  percentFor?(code: string): number
}

/** A future automatic transfer (e.g. ЮKassa Payouts API). Not used yet: payouts are made by hand by the owner. */
export interface PayoutProvider {
  readonly name: string
  send(payout: PayoutView & { phone: string; bank: string; recipient: string }): Promise<{ reference: string }>
}

export type PayoutStatus = 'pending' | 'paid' | 'rejected'
export interface PayoutView {
  id: string
  /** Roubles. */
  amount: number
  status: PayoutStatus
  auto: boolean
  createdAt: string
  decidedAt?: string
  comment?: string
  /** «+7 ••• •••-12-34 · Т-Банк» for the streamer. */
  destination: string
}

export interface PayoutDetails { phone: string; bank: string; recipient: string }

/** A streamer's new-event: a payment by his link («деньги по ссылке») or a payout the owner marked paid. */
export interface StreamerNotice {
  type: 'payment' | 'payout'
  /** ISO time of the event. */
  at: string
  /** Roubles: the streamer's share of a payment, or the amount of a paid payout. */
  amount: number
}

export class PayoutError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Smallest payout, kopecks (100 ₽). */
export const MIN_PAYOUT = 100_00
/** Only the default for the (now unused) auto column; auto-payout was removed (owner, 25.11.2026). */
const AUTO_COLUMN_DEFAULT = 3
const DAY_MS = 24 * 60 * 60 * 1000

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS streamer_payouts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    code TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL CHECK (status IN ('pending','paid','rejected')),
    auto INTEGER NOT NULL DEFAULT 0,
    phone TEXT NOT NULL,
    bank TEXT NOT NULL,
    recipient TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    comment TEXT,
    provider TEXT,
    provider_ref TEXT);
  CREATE INDEX IF NOT EXISTS streamer_payouts_code ON streamer_payouts(code, status);
  CREATE UNIQUE INDEX IF NOT EXISTS streamer_payouts_one_pending ON streamer_payouts(code) WHERE status = 'pending';
  CREATE TABLE IF NOT EXISTS streamer_payout_settings (
    account_id TEXT PRIMARY KEY,
    phone TEXT,
    bank TEXT,
    recipient TEXT,
    auto INTEGER NOT NULL DEFAULT 1,
    interval_days INTEGER NOT NULL DEFAULT ${AUTO_COLUMN_DEFAULT},
    cycle_started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS payout_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS streamer_notice_seen (
    account_id TEXT PRIMARY KEY,
    seen_at INTEGER NOT NULL);
`

/** +7XXXXXXXXXX from «8 (999) 123-45-67», «+7 999 1234567» and the like; undefined for anything else. */
export function normalizePhone(raw: unknown) {
  const digits = String(raw ?? '').replace(/[\s()+-]/g, '')
  if (!/^\d+$/.test(digits)) return undefined
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) return `+7${digits.slice(1)}`
  if (digits.length === 10 && digits.startsWith('9')) return `+7${digits}`
  return undefined
}

export const maskPhone = (phone: string) => `+7 ••• •••-${phone.slice(-4, -2)}-${phone.slice(-2)}`
const rub = (kopecks: number) => kopecks / 100

export function validateDetails(input: { phone?: unknown; bank?: unknown; recipient?: unknown }): PayoutDetails {
  const phone = normalizePhone(input.phone)
  if (!phone) throw new PayoutError(400, 'Телефон для СБП: российский номер, например +7 999 123-45-67')
  const bank = String(input.bank ?? '').trim().replace(/\s+/g, ' ')
  if (!/^[\p{L}\p{N} .,«»"'()-]{2,60}$/u.test(bank)) throw new PayoutError(400, 'Укажите банк получателя (2–60 символов)')
  const recipient = String(input.recipient ?? '').trim().replace(/\s+/g, ' ')
  if (!/^[\p{L}][\p{L} .'-]{1,99}$/u.test(recipient) || !recipient.includes(' ')) throw new PayoutError(400, 'Укажите имя и фамилию получателя, как в банке')
  return { phone, bank, recipient }
}

export class PayoutStore {
  private readonly db: DatabaseSync
  private readonly source: EarningsSource
  private readonly now: () => number
  /** Not used yet (manual payouts); see PayoutProvider. */
  readonly provider?: PayoutProvider

  constructor(db: DatabaseSync, source: EarningsSource, options: { now?: () => number; provider?: PayoutProvider } = {}) {
    this.db = db
    this.source = source
    this.now = options.now ?? Date.now
    this.provider = options.provider
    this.db.exec(SCHEMA)
  }

  /** Balance in kopecks. */
  balance(code: string) {
    const earned = this.source.streamerEarned(code)
    // «К выводу» — только заработок с платежей старше 14 дней (на случай возврата), минус уже выплаченное и то, что в
    // заявках; «зреет» — заработок последних 14 дней, пока недоступный (src/shared/revenue.ts PAYOUT_MATURITY_DAYS).
    const matured = this.source.streamerMatured(code, this.now() - PAYOUT_MATURITY_DAYS * DAY_MS)
    const sums = this.db.prepare("SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid, COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS pending FROM streamer_payouts WHERE code = ?").get(code) as Row
    const paid = Number(sums.paid)
    const pending = Number(sums.pending)
    return { earned, matured, maturing: Math.max(0, earned - matured), paid, pending, available: Math.max(0, matured - paid - pending) }
  }

  /** How many payout requests wait for the owner now (the red count on «Стримеры»). */
  pendingCount() {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM streamer_payouts WHERE status = 'pending'").get() as Row).n)
  }

  private settingsRow(accountId: string) {
    return this.db.prepare('SELECT * FROM streamer_payout_settings WHERE account_id = ?').get(accountId) as Row | undefined
  }

  /** The streamer's own view: share, totals, details (masked) and history. */
  overview(accountId: string, code: string) {
    const balance = this.balance(code)
    const settings = this.settingsRow(accountId)
    const hasDetails = Boolean(settings?.phone)
    return {
      percent: this.source.percentFor?.(code) ?? this.source.streamerPercent,
      earned: rub(balance.earned),
      paidOut: rub(balance.paid),
      pending: rub(balance.pending),
      available: rub(balance.available),
      // «Зреет» и правило 14 дней: заработок последних дней станет доступен к выводу позже (на случай возврата).
      maturing: rub(balance.maturing),
      maturityDays: PAYOUT_MATURITY_DAYS,
      minimum: rub(MIN_PAYOUT),
      currency: 'RUB' as const,
      details: hasDetails ? { phone: maskPhone(String(settings!.phone)), bank: String(settings!.bank), recipient: String(settings!.recipient) } : null,
      payouts: this.history(code),
    }
  }

  history(code: string): PayoutView[] {
    return (this.db.prepare('SELECT * FROM streamer_payouts WHERE code = ? ORDER BY created_at DESC, rowid DESC LIMIT 100').all(code) as Row[]).map(toView)
  }

  /**
   * The streamer's new-events (owner, 25.11.2026): payments by his link and payouts the owner marked paid, newest first;
   * `unread` are those after he last opened the panel («красный кружок»). The owner pressing «Выплачено» becomes a
   * «выплата проведена» event here; a new succeeded payment by his code becomes a «новая оплата» event.
   */
  notices(accountId: string, code: string): { unread: number; seenAt: string | null; items: StreamerNotice[] } {
    const seen = this.db.prepare('SELECT seen_at FROM streamer_notice_seen WHERE account_id = ?').get(accountId) as Row | undefined
    const seenAt = seen ? Number(seen.seen_at) : 0
    const events: Array<StreamerNotice & { ms: number }> = []
    for (const row of this.db.prepare("SELECT COALESCE(paid_at, created_at) AS at, streamer_earning AS earning FROM payments WHERE referral_code = ? AND status = 'succeeded' AND amount > 0 ORDER BY at DESC LIMIT 30").all(code) as Row[]) {
      events.push({ type: 'payment', ms: Number(row.at), at: new Date(Number(row.at)).toISOString(), amount: rub(Number(row.earning ?? 0)) })
    }
    for (const row of this.db.prepare("SELECT amount, decided_at FROM streamer_payouts WHERE account_id = ? AND status = 'paid' AND decided_at IS NOT NULL ORDER BY decided_at DESC LIMIT 30").all(accountId) as Row[]) {
      events.push({ type: 'payout', ms: Number(row.decided_at), at: new Date(Number(row.decided_at)).toISOString(), amount: rub(Number(row.amount)) })
    }
    const items = events.sort((a, b) => b.ms - a.ms).slice(0, 30)
    return {
      unread: items.filter((item) => item.ms > seenAt).length,
      seenAt: seenAt ? new Date(seenAt).toISOString() : null,
      items: items.map(({ ms: _ms, ...rest }) => rest),
    }
  }

  /** The streamer opened the panel: his new-events are no longer «new». */
  markNoticesSeen(accountId: string) {
    this.db.prepare('INSERT INTO streamer_notice_seen (account_id, seen_at) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET seen_at = excluded.seen_at').run(accountId, this.now())
  }

  /**
   * The streamer's payout details — recipient, phone (СБП) and bank — which he fills and saves for the owner to transfer
   * by hand. Validated (validateDetails); a new phone replaces the old one. Auto-payout was removed (owner, 25.11.2026):
   * `auto` is always 0, so saving the details also clears any old auto flag and nothing is triggered.
   */
  saveSettings(accountId: string, input: { phone?: unknown; bank?: unknown; recipient?: unknown }) {
    const details = validateDetails(input)
    const now = this.now()
    this.db.prepare(`INSERT INTO streamer_payout_settings (account_id, phone, bank, recipient, auto, interval_days, cycle_started_at, updated_at) VALUES (?, ?, ?, ?, 0, ${AUTO_COLUMN_DEFAULT}, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET phone = excluded.phone, bank = excluded.bank, recipient = excluded.recipient, auto = 0, updated_at = excluded.updated_at`)
      .run(accountId, details.phone, details.bank, details.recipient, now, now)
  }

  /** The streamer asks for `amount` roubles (≥ minimum, ≤ available). One open request at a time; details required first. */
  request(accountId: string, code: string, amountRub: number) {
    const amount = Math.round(amountRub * 100)
    if (!Number.isFinite(amountRub) || amount <= 0 || Math.abs(amountRub * 100 - amount) > 1e-6) throw new PayoutError(400, 'Сумма: рубли, не больше двух знаков после запятой')
    if (amount < MIN_PAYOUT) throw new PayoutError(400, `Минимальная выплата — ${rub(MIN_PAYOUT)} ₽`)
    const settings = this.settingsRow(accountId)
    if (!settings?.phone) throw new PayoutError(400, 'Сначала укажите реквизиты для выплаты')
    return transaction(this.db, () => {
      if (this.db.prepare("SELECT 1 FROM streamer_payouts WHERE code = ? AND status = 'pending'").get(code)) throw new PayoutError(409, 'Предыдущая заявка ещё ждёт выплаты')
      const { available } = this.balance(code)
      if (amount > available) throw new PayoutError(400, `Доступно к выплате только ${rub(available)} ₽`)
      const id = randomBytes(12).toString('hex')
      this.db.prepare("INSERT INTO streamer_payouts (id, account_id, code, amount, status, auto, phone, bank, recipient, created_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)")
        .run(id, accountId, code, amount, String(settings.phone), String(settings.bank), String(settings.recipient), this.now())
      return toView(this.db.prepare('SELECT * FROM streamer_payouts WHERE id = ?').get(id) as Row)
    })
  }

  /** Owner's list: every request with the full phone for the transfer. */
  ownerList(emailOf: (accountId: string) => string | undefined) {
    return (this.db.prepare("SELECT * FROM streamer_payouts ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC, rowid DESC LIMIT 300").all() as Row[]).map((row) => ({
      ...toView(row),
      code: String(row.code),
      email: emailOf(String(row.account_id)) ?? '',
      phone: String(row.phone),
      bank: String(row.bank),
      recipient: String(row.recipient),
    }))
  }

  /** Owner marks a pending request paid (money sent) or rejected (the amount returns to the balance). */
  decide(id: string, status: 'paid' | 'rejected', comment?: string) {
    const note = comment?.trim().slice(0, 200) || null
    const changed = this.db.prepare("UPDATE streamer_payouts SET status = ?, decided_at = ?, comment = ? WHERE id = ? AND status = 'pending'").run(status, this.now(), note, id)
    if (!Number(changed.changes)) {
      const exists = this.db.prepare('SELECT status FROM streamer_payouts WHERE id = ?').get(id) as Row | undefined
      throw new PayoutError(exists ? 409 : 404, exists ? 'Заявка уже обработана' : 'Заявка не найдена')
    }
    return toView(this.db.prepare('SELECT * FROM streamer_payouts WHERE id = ?').get(id) as Row)
  }
}

function toView(row: Row): PayoutView {
  return {
    id: String(row.id),
    amount: Number(row.amount) / 100,
    status: row.status as PayoutStatus,
    auto: Number(row.auto) === 1,
    createdAt: new Date(Number(row.created_at)).toISOString(),
    ...(row.decided_at == null ? {} : { decidedAt: new Date(Number(row.decided_at)).toISOString() }),
    ...(row.comment == null ? {} : { comment: String(row.comment) }),
    destination: `${maskPhone(String(row.phone))} · ${String(row.bank)}`,
  }
}
