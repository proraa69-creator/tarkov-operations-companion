/**
 * Streamer payouts: a small ledger next to the payments (same SQLite database).
 *
 *   earned     — the streamer's stored share of every succeeded payment of users who came by his link
 *                (PaymentStore fixes the percent per payment when it succeeds, so later changes never rewrite history);
 *   paid out   — payout requests the owner marked «Выплачено»;
 *   pending    — requests waiting for the owner («Ожидает выплаты»);
 *   available  — earned − paid out − pending, never negative.
 *
 * The streamer requests any amount from the minimum up to the available balance, one open request at a time, or turns
 * on auto-payout: every N days (he picks N within the owner's limits, default 3) the server itself creates a request for
 * the whole available balance. Money is NOT moved by the server yet: the owner transfers it (SBP by phone) and marks the
 * request paid. A real transfer provider (e.g. ЮKassa «Выплаты», which needs its own contract, agent id and key) can be
 * plugged in through `PayoutProvider` later without changing the ledger.
 *
 * Payout details: only what a manual SBP transfer needs — phone, bank name and recipient name. Card numbers are never
 * accepted or stored (that would put the server under PCI DSS). The streamer sees his phone masked; the owner sees it
 * in full to make the transfer.
 */
import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.js'

type Row = Record<string, unknown>

/** Where earnings come from (PaymentStore). Amounts in kopecks. */
export interface EarningsSource {
  streamerEarned(code: string): number
  readonly streamerPercent: number
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

export class PayoutError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Smallest payout, kopecks (100 ₽). */
export const MIN_PAYOUT = 100_00
export const DEFAULT_AUTO_INTERVAL_DAYS = 3
export const DEFAULT_INTERVAL_LIMITS = { min: 1, max: 30 }
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
    interval_days INTEGER NOT NULL DEFAULT ${DEFAULT_AUTO_INTERVAL_DAYS},
    cycle_started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS payout_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL);
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

  /** Owner's limits for the auto-payout interval the streamers may choose. */
  intervalLimits() {
    const read = (key: string, fallback: number) => {
      const row = this.db.prepare('SELECT value FROM payout_config WHERE key = ?').get(key) as Row | undefined
      const value = Number(row?.value)
      return Number.isInteger(value) && value >= 1 && value <= 365 ? value : fallback
    }
    return { min: read('interval_min_days', DEFAULT_INTERVAL_LIMITS.min), max: read('interval_max_days', DEFAULT_INTERVAL_LIMITS.max) }
  }

  setIntervalLimits(min: number, max: number) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 365 || min > max) throw new PayoutError(400, 'Интервал автовыплаты: целые дни от 1 до 365, минимум не больше максимума')
    const put = this.db.prepare('INSERT INTO payout_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    put.run('interval_min_days', String(min))
    put.run('interval_max_days', String(max))
    // Streamers outside the new limits are moved to the nearest allowed value.
    this.db.prepare('UPDATE streamer_payout_settings SET interval_days = MIN(MAX(interval_days, ?), ?)').run(min, max)
    return this.intervalLimits()
  }

  /** Balance in kopecks. */
  balance(code: string) {
    const earned = this.source.streamerEarned(code)
    const sums = this.db.prepare("SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid, COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS pending FROM streamer_payouts WHERE code = ?").get(code) as Row
    const paid = Number(sums.paid)
    const pending = Number(sums.pending)
    return { earned, paid, pending, available: Math.max(0, earned - paid - pending) }
  }

  private settingsRow(accountId: string) {
    return this.db.prepare('SELECT * FROM streamer_payout_settings WHERE account_id = ?').get(accountId) as Row | undefined
  }

  /** The streamer's own view: share, totals, details (masked), auto-payout and history. */
  overview(accountId: string, code: string) {
    const balance = this.balance(code)
    const settings = this.settingsRow(accountId)
    const limits = this.intervalLimits()
    const intervalDays = settings ? Number(settings.interval_days) : Math.min(Math.max(DEFAULT_AUTO_INTERVAL_DAYS, limits.min), limits.max)
    const auto = settings ? Number(settings.auto) === 1 : true
    const hasDetails = Boolean(settings?.phone)
    return {
      percent: this.source.streamerPercent,
      earned: rub(balance.earned),
      paidOut: rub(balance.paid),
      pending: rub(balance.pending),
      available: rub(balance.available),
      minimum: rub(MIN_PAYOUT),
      currency: 'RUB' as const,
      details: hasDetails ? { phone: maskPhone(String(settings!.phone)), bank: String(settings!.bank), recipient: String(settings!.recipient) } : null,
      autoPayout: {
        enabled: auto,
        intervalDays,
        limits,
        nextAt: auto && hasDetails ? new Date(Number(settings!.cycle_started_at) + intervalDays * DAY_MS).toISOString() : null,
      },
      payouts: this.history(code),
    }
  }

  history(code: string): PayoutView[] {
    return (this.db.prepare('SELECT * FROM streamer_payouts WHERE code = ? ORDER BY created_at DESC, rowid DESC LIMIT 100').all(code) as Row[]).map(toView)
  }

  /**
   * Payout details and auto-payout choice. Details are optional when only the auto-payout changes; a new phone replaces
   * the old one. Changing the interval starts a new cycle from now.
   */
  saveSettings(accountId: string, input: { phone?: unknown; bank?: unknown; recipient?: unknown; auto?: unknown; intervalDays?: unknown }) {
    const current = this.settingsRow(accountId)
    const detailsGiven = input.phone !== undefined || input.bank !== undefined || input.recipient !== undefined
    const details = detailsGiven ? validateDetails(input) : current?.phone ? { phone: String(current.phone), bank: String(current.bank), recipient: String(current.recipient) } : null
    const limits = this.intervalLimits()
    const interval = input.intervalDays === undefined ? (current ? Number(current.interval_days) : Math.min(Math.max(DEFAULT_AUTO_INTERVAL_DAYS, limits.min), limits.max)) : Number(input.intervalDays)
    if (!Number.isInteger(interval) || interval < limits.min || interval > limits.max) throw new PayoutError(400, `Автовыплата: раз в ${limits.min}–${limits.max} дн.`)
    const auto = input.auto === undefined ? (current ? Number(current.auto) === 1 : true) : input.auto === true
    const now = this.now()
    const restart = !current || interval !== Number(current.interval_days) || (auto && Number(current.auto) !== 1)
    this.db.prepare(`INSERT INTO streamer_payout_settings (account_id, phone, bank, recipient, auto, interval_days, cycle_started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET phone = excluded.phone, bank = excluded.bank, recipient = excluded.recipient, auto = excluded.auto, interval_days = excluded.interval_days,
        cycle_started_at = CASE WHEN ? THEN excluded.cycle_started_at ELSE cycle_started_at END, updated_at = excluded.updated_at`)
      .run(accountId, details?.phone ?? null, details?.bank ?? null, details?.recipient ?? null, auto ? 1 : 0, interval, now, now, restart ? 1 : 0)
  }

  /** The streamer asks for `amount` roubles (≥ minimum, ≤ available). One open request at a time. */
  request(accountId: string, code: string, amountRub: number, auto = false) {
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
      this.db.prepare("INSERT INTO streamer_payouts (id, account_id, code, amount, status, auto, phone, bank, recipient, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)")
        .run(id, accountId, code, amount, auto ? 1 : 0, String(settings.phone), String(settings.bank), String(settings.recipient), this.now())
      return toView(this.db.prepare('SELECT * FROM streamer_payouts WHERE id = ?').get(id) as Row)
    })
  }

  /**
   * Auto-payout tick (index.ts runs it every hour): for every streamer whose N-day cycle is over, request the whole
   * available balance (if it reaches the minimum and nothing is pending) and start the next cycle.
   * `codeOf` maps an account to its current streamer code (undefined when it is no longer a streamer).
   */
  runAuto(codeOf: (accountId: string) => string | undefined) {
    const now = this.now()
    const due = this.db.prepare('SELECT * FROM streamer_payout_settings WHERE auto = 1 AND phone IS NOT NULL AND cycle_started_at + interval_days * ? <= ?').all(DAY_MS, now) as Row[]
    const created: PayoutView[] = []
    for (const row of due) {
      const accountId = String(row.account_id)
      const code = codeOf(accountId)
      this.db.prepare('UPDATE streamer_payout_settings SET cycle_started_at = ? WHERE account_id = ?').run(now, accountId)
      if (!code) continue
      const { available } = this.balance(code)
      if (available < MIN_PAYOUT) continue
      try {
        created.push(this.request(accountId, code, available / 100, true))
      } catch (error) {
        if (!(error instanceof PayoutError)) throw error // a pending request already exists: next cycle
      }
    }
    return created
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
