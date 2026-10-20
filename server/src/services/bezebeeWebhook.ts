/**
 * BZB (Bezebee) payment notifications (owner, 20.10.2026: «в отчёте об оплате сумма, какая подписка и какая почта. А там
 * уже подтверждаться должно само»). BZB's «API ключи для интеграций» send a webhook to the URL set on the key, signed
 * with the key's secret in the X-BZB-Signature header (`v1=<hmac>`; empty while no secret is issued). BZB publishes no
 * schema of the body, so it is read loosely: the payment link (one per plan and region, services/bezebee.ts), the buyer's
 * e-mail, the amount, a paid status and the payment's id, wherever in the JSON they are.
 *
 * Every notification is kept (bezebee_events). Only a signed one (a secret is set and the signature matches) can open a
 * subscription: the account with that e-mail gets the plan's months like the owner's confirmation (BezebeePayments.confirm),
 * the referral link spends the friend discount. One that cannot be matched — the buyer gave only Telegram, another e-mail,
 * an account from Russia… — waits in the owner's panel as «не сопоставлено» to be attached to an account by hand.
 * The same payment (its id, else the body) is applied once.
 *
 * The API token and the webhook secret: pasted by the owner in the panel (bezebee-credentials.json next to the database,
 * mode 600) or BEZEBEE_API_TOKEN / BEZEBEE_WEBHOOK_SECRET; never logged, never sent back.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { BEZEBEE_TARIFFS, BezebeeConfirmError, type BezebeePayments, type BezebeePlanId, type BezebeeRegion } from './bezebee.js'

type Row = Record<string, unknown>

/** `mailUser` / `mailPassword`: the project mailbox with BZB's sale letters and its app password (services/bezebeeMail.ts). */
export interface BezebeeCredentials { apiToken?: string; webhookSecret?: string; mailUser?: string; mailPassword?: string }

/** Where the owner's pasted token and secret live; without a file (tests) they stay in memory. */
export class BezebeeCredentialStore {
  private memory: BezebeeCredentials = {}

  constructor(private readonly file: string | undefined, private readonly env: BezebeeCredentials = {}) {}

  load(): BezebeeCredentials {
    let saved: BezebeeCredentials = this.memory
    if (this.file && existsSync(this.file)) {
      try {
        const value = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>
        saved = { apiToken: text(value.apiToken), webhookSecret: text(value.webhookSecret), mailUser: text(value.mailUser), mailPassword: text(value.mailPassword) }
      } catch { saved = {} }
    }
    return {
      apiToken: saved.apiToken || this.env.apiToken || undefined,
      webhookSecret: saved.webhookSecret || this.env.webhookSecret || undefined,
      mailUser: saved.mailUser || undefined,
      mailPassword: saved.mailPassword || undefined,
    }
  }

  /** A blank value keeps what is set; `null` removes it. */
  save(next: { apiToken?: string | null; webhookSecret?: string | null; mailUser?: string | null; mailPassword?: string | null }) {
    const current = this.file && existsSync(this.file) ? (() => { try { return JSON.parse(readFileSync(this.file!, 'utf8')) as BezebeeCredentials } catch { return {} } })() : this.memory
    const merged: BezebeeCredentials = {
      apiToken: next.apiToken === null ? undefined : text(next.apiToken) || current.apiToken,
      webhookSecret: next.webhookSecret === null ? undefined : text(next.webhookSecret) || current.webhookSecret,
      mailUser: next.mailUser === null ? undefined : text(next.mailUser).toLowerCase() || current.mailUser,
      mailPassword: next.mailPassword === null ? undefined : text(next.mailPassword) || current.mailPassword,
    }
    if (!this.file) { this.memory = merged; return }
    mkdirSync(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify({ ...merged, savedAt: new Date().toISOString() }), { mode: 0o600 })
    chmodSync(temporary, 0o600)
    renameSync(temporary, this.file)
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/**
 * The X-BZB-Signature header against the secret: `v1=` holds an HMAC-SHA256 of the raw body (hex or base64), or of
 * `${t}.${body}` when the header carries a `t=` time. Constant-time comparison.
 */
export function bezebeeSignatureValid(header: string | undefined, body: Buffer, secret: string) {
  if (!header || !secret) return false
  const parts = new Map<string, string[]>()
  for (const piece of header.split(',')) {
    const at = piece.indexOf('=')
    if (at <= 0) continue
    const key = piece.slice(0, at).trim()
    parts.set(key, [...(parts.get(key) ?? []), piece.slice(at + 1).trim()])
  }
  const given = parts.get('v1')?.filter(Boolean) ?? []
  if (!given.length) return false
  const time = parts.get('t')?.[0]
  const payloads = [body, ...(time ? [Buffer.concat([Buffer.from(`${time}.`), body])] : [])]
  for (const payload of payloads) {
    const digest = createHmac('sha256', secret).update(payload).digest()
    const expected = [Buffer.from(digest.toString('hex')), Buffer.from(digest.toString('base64')), Buffer.from(digest.toString('base64url'))]
    for (const value of given) {
      const candidate = Buffer.from(value)
      if (expected.some((wanted) => wanted.length === candidate.length && timingSafeEqual(wanted, candidate))) return true
    }
  }
  return false
}

/** Every string / number under the body with the path of keys to it. */
function leaves(value: unknown, path: string[] = [], out: Array<{ path: string[]; value: string | number | boolean }> = []) {
  if (out.length > 2000) return out
  if (Array.isArray(value)) value.forEach((item, index) => leaves(item, [...path, String(index)], out))
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) leaves(item, [...path, key.toLowerCase()], out)
  else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out.push({ path, value })
  return out
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/
const PAID = /^(succeeded|success|successful|paid|completed|complete|confirmed|captured|done|approved|payment[._]?(succeeded|success|paid|completed|confirmed))$/i
const FAILED = /^(failed|failure|canceled|cancelled|declined|refunded|expired|rejected|chargeback|payment[._]?(failed|canceled|cancelled|refunded))$/i

type Tariff = { region: BezebeeRegion; plan: BezebeePlanId; friend: boolean; price: number; currency: 'RUB' | 'USD'; link: string }

/**
 * The tariff by the sum paid when the link is not named the way the pages are (owner's screenshot, 20.10.2026: the API
 * lists the links by UUIDs, not by the short ids of pay.bezebee.com). Every price of the table is distinct — roubles
 * 240/300/810/1500/2400, dollars 5.5/7/19/35/60 — so the sum (or the sum in kopecks / cents) names one tariff; with a
 * currency only that region's tariffs count.
 */
export function bezebeeTariffByAmount(amount: number | undefined, currency: string | undefined): Tariff | undefined {
  if (!amount || !Number.isFinite(amount)) return undefined
  const matches: Tariff[] = []
  for (const region of ['CIS', 'WORLD'] as const) {
    const tariffs = BEZEBEE_TARIFFS[region]
    if (currency && currency !== tariffs.currency) continue
    const all = [...tariffs.plans.map((plan) => ({ ...plan, friend: false })), { ...tariffs.friend, months: 1, friend: true }]
    for (const entry of all) {
      if (Math.abs(amount - entry.price) < 0.005 || Math.abs(amount / 100 - entry.price) < 0.005) matches.push({ region, plan: entry.plan, friend: entry.friend, price: entry.price, currency: tariffs.currency, link: entry.url.split('/').pop()! })
    }
  }
  return matches.length === 1 ? matches[0] : undefined
}

/** The tariff a payment link (its id or URL anywhere in the body) is for. */
function tariffOf(values: string[]): Tariff | undefined {
  for (const region of ['CIS', 'WORLD'] as const) {
    const tariffs = BEZEBEE_TARIFFS[region]
    const all = [...tariffs.plans.map((plan) => ({ ...plan, friend: false })), { ...tariffs.friend, months: 1, friend: true }]
    for (const entry of all) {
      const link = entry.url.split('/').pop()!
      if (values.some((value) => value === link || value.endsWith(`/${link}`) || value.includes(`/${link}?`))) {
        return { region, plan: entry.plan, friend: entry.friend, price: entry.price, currency: tariffs.currency, link }
      }
    }
  }
  return undefined
}

export interface BezebeeNotice {
  paymentId?: string
  email?: string
  telegram?: string
  status: 'paid' | 'failed' | 'unknown'
  amount?: number
  currency?: string
  tariff?: ReturnType<typeof tariffOf>
}

/** What a notification says, read loosely (BZB publishes no schema). */
export function readBezebeeNotice(body: unknown): BezebeeNotice {
  const all = leaves(body)
  const strings = all.filter((leaf) => typeof leaf.value === 'string').map((leaf) => ({ path: leaf.path, value: String(leaf.value).trim() }))
  const keyed = (pattern: RegExp) => strings.filter((leaf) => pattern.test(leaf.path.at(-1) ?? ''))
  const email = keyed(/e-?mail/).map((leaf) => leaf.value).find((value) => EMAIL.test(value)) ?? strings.map((leaf) => leaf.value).find((value) => EMAIL.test(value))
  const telegram = keyed(/telegram|tg/).map((leaf) => leaf.value).find(Boolean)
  const statusValues = [...keyed(/^(status|state|event|type|event_type|payment_status)$/).map((leaf) => leaf.value)]
  const status = statusValues.some((value) => FAILED.test(value)) ? 'failed' : statusValues.some((value) => PAID.test(value)) || all.some((leaf) => /^(paid|is_paid|succeeded)$/.test(leaf.path.at(-1) ?? '') && leaf.value === true) ? 'paid' : 'unknown'
  const idLeaf = keyed(/^(payment_id|transaction_id|operation_id|order_id|invoice_id)$/)[0] ?? strings.find((leaf) => leaf.path.length <= 2 && leaf.path.at(-1) === 'id' && (leaf.path.length === 1 || /payment|transaction|operation|order|data|object/.test(leaf.path[0] ?? '')))
  const numbers = all.filter((leaf) => /^(amount|sum|total|total_amount|paid_amount|price)$/.test(leaf.path.at(-1) ?? ''))
  const amountLeaf = numbers.find((leaf) => Number.isFinite(Number(leaf.value)) && Number(leaf.value) > 0)
  const currency = keyed(/^currency$/).map((leaf) => leaf.value.toUpperCase()).find((value) => /^[A-Z]{3}$/.test(value))
  return {
    ...(idLeaf ? { paymentId: idLeaf.value.slice(0, 120) } : {}),
    ...(email ? { email: email.toLowerCase() } : {}),
    ...(telegram ? { telegram: telegram.slice(0, 64) } : {}),
    status,
    ...(amountLeaf ? { amount: Number(amountLeaf.value) } : {}),
    ...(currency ? { currency } : {}),
    tariff: tariffOf(strings.map((leaf) => leaf.value)) ?? bezebeeTariffByAmount(amountLeaf ? Number(amountLeaf.value) : undefined, currency),
  }
}

export type BezebeeEventStatus = 'confirmed' | 'unmatched' | 'ignored' | 'unverified' | 'duplicate'

export interface BezebeeEventView {
  id: number
  receivedAt: string
  status: BezebeeEventStatus
  signature: 'ok' | 'unsigned' | 'bad'
  detail?: string
  email?: string
  telegram?: string
  plan?: BezebeePlanId
  region?: BezebeeRegion
  friend?: true
  amount?: number
  currency?: string
  paymentId?: string
  accountEmail?: string
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS bezebee_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at INTEGER NOT NULL,
    event_key TEXT NOT NULL,
    signature TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    email TEXT,
    telegram TEXT,
    plan TEXT,
    region TEXT,
    friend INTEGER,
    amount REAL,
    currency TEXT,
    payment_id TEXT,
    account_id TEXT,
    payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS bezebee_events_key ON bezebee_events(event_key);
  CREATE INDEX IF NOT EXISTS bezebee_events_status ON bezebee_events(status, received_at);
`

/** Notifications kept for the panel: the newest this many. */
const KEEP_EVENTS = 2000
/** A dollar in roubles for the revenue of a WORLD payment (BZB pays out in roubles; the panel says it is an estimate). */
const DEFAULT_USD_RUB = 90

export class BezebeeWebhooks {
  constructor(
    private readonly db: DatabaseSync,
    private readonly payments: BezebeePayments,
    private readonly credentials: BezebeeCredentialStore,
    private readonly options: { now?: () => number; usdRub?: number; emailOf?: (accountId: string) => string | undefined } = {},
  ) {
    this.db.exec(SCHEMA)
  }

  private now() { return this.options.now?.() ?? Date.now() }

  /** One notification: kept, and applied when it is signed, paid and matches an account. Answers what happened. */
  receive(rawBody: Buffer, signatureHeader: string | undefined): BezebeeEventView {
    const secret = this.credentials.load().webhookSecret
    const signature: BezebeeEventView['signature'] = !secret ? 'unsigned' : bezebeeSignatureValid(signatureHeader, rawBody, secret) ? 'ok' : 'bad'
    let body: unknown
    try { body = JSON.parse(rawBody.toString('utf8')) } catch { body = undefined }
    const notice = body === undefined ? undefined : readBezebeeNotice(body)
    const key = notice?.paymentId ? `id:${notice.paymentId}` : `body:${createHash('sha256').update(rawBody).digest('hex')}`
    const record = (status: BezebeeEventStatus, detail?: string, accountId?: string) => this.store(key, signature, status, detail, notice, rawBody, accountId)

    if (signature === 'bad') return record('ignored', 'Подпись X-BZB-Signature не совпала — уведомление не от BZB или сменился секрет')
    if (!notice) return record('ignored', 'Тело уведомления — не JSON')
    if (notice.status === 'failed') return record('ignored', 'Платёж не прошёл')
    const applied = this.db.prepare("SELECT 1 FROM bezebee_events WHERE event_key = ? AND status = 'confirmed'").get(key)
    if (applied) return record('duplicate', 'Этот платёж уже зачислен')
    if (signature === 'unsigned') return record('unverified', 'Секрет подписи вебхуков не задан — уведомление сохранено, подписка не открыта')
    if (notice.status !== 'paid') return record('ignored', 'В уведомлении нет признака успешной оплаты')
    if (!notice.tariff) return record('unmatched', 'Ссылка оплаты не из тарифов Raid OS')
    if (!notice.email) return record('unmatched', notice.telegram ? 'Покупатель указал только Telegram' : 'В уведомлении нет e-mail покупателя')
    return this.apply(key, signature, notice, rawBody, notice.email)
  }

  /**
   * A sale read from BZB's letter (services/bezebeeMail.ts): kept once (its Message-ID), applied like a signed webhook
   * when the receiving Gmail vouches that it comes from bezebee.com; otherwise it waits as «без подписи».
   */
  receiveSale(sale: { key: string; verified: boolean; notice: BezebeeNotice; summary: Record<string, unknown> }) {
    if (this.db.prepare('SELECT 1 FROM bezebee_events WHERE event_key = ?').get(sale.key)) return undefined
    const { notice } = sale
    // The panel's JSON; amount, currency and e-mail in it let «Привязать к аккаунту» read the letter again.
    const body = Buffer.from(JSON.stringify({ ...sale.summary, ...(notice.amount ? { amount: notice.amount } : {}), ...(notice.currency ? { currency: notice.currency } : {}), ...(notice.email ? { email: notice.email } : {}) }))
    const signature: BezebeeEventView['signature'] = sale.verified ? 'ok' : 'unsigned'
    const record = (status: BezebeeEventStatus, detail: string) => this.store(sale.key, signature, status, detail, notice, body)
    if (!sale.verified) return record('unverified', 'Письмо BZB без подтверждения Gmail (DKIM/SPF) — проверьте его и привяжите вручную')
    if (notice.status !== 'paid') return record('ignored', 'В письме нет строки об оплате')
    if (!notice.tariff) return record('unmatched', 'Сумма в письме не совпала ни с одним тарифом Raid OS')
    if (!notice.email) return record('unmatched', notice.telegram ? 'Покупатель указал только Telegram' : 'В письме нет e-mail покупателя')
    return this.apply(sale.key, signature, notice, body, notice.email)
  }

  /** «Привязать к аккаунту» (owner): an unmatched / unverified notification applied to the account with `email`. */
  attach(eventId: number, email: string, actor: string) {
    const row = this.db.prepare('SELECT * FROM bezebee_events WHERE id = ?').get(eventId) as Row | undefined
    if (!row) throw new BezebeeConfirmError(404, 'not_found', 'Уведомление не найдено')
    if (row.status === 'confirmed') throw new BezebeeConfirmError(409, 'already', 'Это уведомление уже зачислено')
    if (this.db.prepare("SELECT 1 FROM bezebee_events WHERE event_key = ? AND status = 'confirmed'").get(String(row.event_key))) throw new BezebeeConfirmError(409, 'already', 'Этот платёж уже зачислен')
    let notice: BezebeeNotice
    try { notice = readBezebeeNotice(JSON.parse(String(row.payload))) } catch { throw new BezebeeConfirmError(400, 'payload', 'Тело уведомления не читается') }
    if (!notice.tariff) throw new BezebeeConfirmError(400, 'tariff', 'Ссылка оплаты не из тарифов Raid OS — подтвердите оплату вручную с тарифом')
    const confirmed = this.confirm(notice, email, actor, String(row.event_key))
    this.db.prepare("UPDATE bezebee_events SET status = 'confirmed', detail = ?, account_id = ? WHERE id = ?").run(`Привязано владельцем к ${email}`, confirmed.accountId, eventId)
    return { event: this.view(this.db.prepare('SELECT * FROM bezebee_events WHERE id = ?').get(eventId) as Row), ...confirmed }
  }

  /** «Убрать» (owner): an unmatched / unverified notification that is no payment (a test, a stray request) leaves the waiting list. */
  dismiss(eventId: number) {
    const row = this.db.prepare('SELECT status FROM bezebee_events WHERE id = ?').get(eventId) as Row | undefined
    if (!row) throw new BezebeeConfirmError(404, 'not_found', 'Уведомление не найдено')
    if (row.status !== 'unmatched' && row.status !== 'unverified') throw new BezebeeConfirmError(409, 'not_waiting', 'Это уведомление не ждёт привязки')
    this.db.prepare("UPDATE bezebee_events SET status = 'ignored', detail = 'Убрано владельцем из «Ждут привязки»' WHERE id = ?").run(eventId)
    return this.view(this.db.prepare('SELECT * FROM bezebee_events WHERE id = ?').get(eventId) as Row)
  }

  list(input: { status?: BezebeeEventStatus; limit?: number; offset?: number } = {}) {
    const where = input.status ? 'WHERE status = ?' : ''
    const args = input.status ? [input.status] : []
    const rows = this.db.prepare(`SELECT * FROM bezebee_events ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, Math.min(input.limit ?? 50, 200), input.offset ?? 0) as Row[]
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM bezebee_events ${where}`).get(...args) as Row).n)
    const unmatched = Number((this.db.prepare("SELECT COUNT(*) AS n FROM bezebee_events WHERE status IN ('unmatched', 'unverified')").get() as Row).n)
    return { events: rows.map((row) => this.view(row)), total, unmatched }
  }

  /** The raw body of one notification (the owner's panel: «показать JSON»). */
  payload(eventId: number) {
    const row = this.db.prepare('SELECT payload FROM bezebee_events WHERE id = ?').get(eventId) as Row | undefined
    return row ? String(row.payload) : undefined
  }

  /** «Ключ API» / «Секрет подписи» pasted by the owner: blank keeps, null removes. */
  saveCredentials(next: { apiToken?: string | null; webhookSecret?: string | null }) {
    this.credentials.save(next)
    return this.status()
  }

  status() {
    const { apiToken, webhookSecret } = this.credentials.load()
    const last = this.db.prepare('SELECT received_at, signature FROM bezebee_events ORDER BY id DESC LIMIT 1').get() as Row | undefined
    return {
      apiToken: Boolean(apiToken),
      webhookSecret: Boolean(webhookSecret),
      ...(last ? { lastEventAt: new Date(Number(last.received_at)).toISOString(), lastSignature: String(last.signature) } : {}),
    }
  }

  private apply(key: string, signature: BezebeeEventView['signature'], notice: BezebeeNotice, rawBody: Buffer, email: string) {
    try {
      const confirmed = this.confirm(notice, email, 'BZB (автоматически)', key)
      return this.store(key, signature, 'confirmed', `Зачислено: ${notice.tariff!.plan}`, notice, rawBody, confirmed.accountId)
    } catch (error) {
      if (error instanceof BezebeeConfirmError || (error instanceof Error && 'status' in error)) return this.store(key, signature, 'unmatched', error.message, notice, rawBody)
      throw error
    }
  }

  private confirm(notice: BezebeeNotice, email: string, actor: string, key: string) {
    const tariff = notice.tariff!
    // Revenue is kept in roubles: a WORLD payment at the configured rate (an estimate; BZB pays out in roubles).
    const rate = this.options.usdRub ?? DEFAULT_USD_RUB
    // The sum as sent, unless it is the price in kopecks / cents (or another currency): then the table's price.
    const paid = notice.amount && (!notice.currency || notice.currency === tariff.currency) && Math.abs(notice.amount / 100 - tariff.price) >= 0.005 ? notice.amount : tariff.price
    const roubles = tariff.currency === 'RUB' ? paid : Math.round(paid * rate * 100) / 100
    const done = this.payments.confirm(actor, { email, plan: tariff.plan, ...(tariff.friend ? { friend: true } : {}), amount: roubles, reference: key.slice(0, 120) })
    return { accountId: done.accountId, paymentId: done.payment.id, paidUntil: done.paidUntil }
  }

  private store(key: string, signature: BezebeeEventView['signature'], status: BezebeeEventStatus, detail: string | undefined, notice: BezebeeNotice | undefined, rawBody: Buffer, accountId?: string) {
    const tariff = notice?.tariff
    const result = this.db.prepare(`INSERT INTO bezebee_events (received_at, event_key, signature, status, detail, email, telegram, plan, region, friend, amount, currency, payment_id, account_id, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      this.now(), key, signature, status, detail ?? null, notice?.email ?? null, notice?.telegram ?? null, tariff?.plan ?? null, tariff?.region ?? null, tariff?.friend ? 1 : null,
      notice?.amount ?? null, notice?.currency ?? tariff?.currency ?? null, notice?.paymentId ?? null, accountId ?? null, rawBody.toString('utf8').slice(0, 64 * 1024))
    this.db.prepare('DELETE FROM bezebee_events WHERE id <= ?').run(Number(result.lastInsertRowid) - KEEP_EVENTS)
    return this.view(this.db.prepare('SELECT * FROM bezebee_events WHERE id = ?').get(Number(result.lastInsertRowid)) as Row)
  }

  private view(row: Row): BezebeeEventView {
    const accountEmail = row.account_id ? this.options.emailOf?.(String(row.account_id)) : undefined
    return {
      id: Number(row.id),
      receivedAt: new Date(Number(row.received_at)).toISOString(),
      status: String(row.status) as BezebeeEventStatus,
      signature: String(row.signature) as BezebeeEventView['signature'],
      ...(row.detail ? { detail: String(row.detail) } : {}),
      ...(row.email ? { email: String(row.email) } : {}),
      ...(row.telegram ? { telegram: String(row.telegram) } : {}),
      ...(row.plan ? { plan: String(row.plan) as BezebeePlanId } : {}),
      ...(row.region ? { region: String(row.region) as BezebeeRegion } : {}),
      ...(row.friend ? { friend: true as const } : {}),
      ...(row.amount != null ? { amount: Number(row.amount) } : {}),
      ...(row.currency ? { currency: String(row.currency) } : {}),
      ...(row.payment_id ? { paymentId: String(row.payment_id) } : {}),
      ...(accountEmail ? { accountEmail } : {}),
    }
  }
}
