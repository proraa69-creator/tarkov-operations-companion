/**
 * BZB sales by e-mail (owner, 20.10.2026: «уведомление об оплате пришло мне на почту, может ты можешь читать почту и брать
 * оттуда информацию?»). BZB sends no webhook for the payment pages made in its cabinet, but it mails every sale:
 * from no-reply@bezebee.com, «Новая продажа: «Raid OS — Global — 1 Month»», «Покупатель оплатил товар «…» на сумму
 * 7.00 USD… Контакт покупателя: buyer@example.com» or «У вас новая продажа! Товар: … Сумма: 300.00 RUB Контакт
 * покупателя: buyer@example.com». The owner forwards those letters to a mailbox of the project
 * (a Gmail filter) and pastes its address and an app password in the admin panel; the server reads that mailbox over IMAP
 * every minute (services/imapReader.ts, nothing is written there).
 *
 * A letter opens a subscription only when Gmail vouches that it comes from bezebee.com: the topmost
 * Authentication-Results of mx.google.com says dkim=pass for bezebee.com, dmarc=pass for header.from=bezebee.com or
 * spf=pass for a bezebee.com sender. Anyone can write «From: no-reply@bezebee.com»; such a letter waits in the panel as
 * «без подписи». The tariff comes from the sum and the currency (every price of the table is distinct), the account
 * from the buyer's e-mail — the same path as the webhook (services/bezebeeWebhook.ts), one letter (its Message-ID) once.
 */
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { fetchNewMessages, ImapError, type ImapOptions } from './imapReader.js'
import { parseMail, type MailMessage } from './mailMessage.js'
import { bezebeeTariffByAmount, type BezebeeCredentialStore, type BezebeeNotice, type BezebeeWebhooks } from './bezebeeWebhook.js'

export const BEZEBEE_SENDER_DOMAIN = 'bezebee.com'

export interface BezebeeSaleMail {
  key: string
  verified: boolean
  notice: BezebeeNotice
  /** What the panel shows as the notification's JSON. */
  summary: Record<string, unknown>
}

const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,}/
const BEZEBEE = /(^|[.@])bezebee\.com$/i

/** Whether the receiving Gmail vouches that the letter comes from bezebee.com (its topmost Authentication-Results). */
export function vouchedByGmail(mail: MailMessage) {
  const results = mail.headers.find(([name]) => name === 'authentication-results')?.[1]
  if (!results) return false
  const [server, ...checks] = results.split(';').map((piece) => piece.trim())
  if (server.toLowerCase() !== 'mx.google.com') return false
  return checks.some((check) => {
    const method = /^(\w+)=(\w+)/.exec(check)
    if (!method || method[2].toLowerCase() !== 'pass') return false
    const property = (name: string) => new RegExp(`${name}=\\"?([^\\s";)]+)`, 'i').exec(check)?.[1]?.replace(/^@/, '')
    if (method[1].toLowerCase() === 'dkim') return BEZEBEE.test(property('header\\.d') ?? property('header\\.i') ?? '')
    if (method[1].toLowerCase() === 'dmarc') return BEZEBEE.test(property('header\\.from') ?? '')
    if (method[1].toLowerCase() === 'spf') return BEZEBEE.test((property('smtp\\.mailfrom') ?? '').split('@').pop() ?? '')
    return false
  })
}

/**
 * BZB words the sale two ways (owner's letters, 20.10.2026): «Покупатель оплатил товар «…» на сумму 7.00 USD» and
 * «У вас новая продажа! Товар: Raid OS — СНГ — 1 месяц / Сумма: 300.00 RUB». The second counts only in a «новая продажа»
 * letter, so that another letter of BZB with a «Сумма:» line (a payout, a refund) never opens a subscription.
 */
const CURRENCY = String.raw`([A-Z]{3}|₽|руб\.?|\$)`
const SALE_SENTENCE = new RegExp(String.raw`оплатил\S*\s+товар\s+«([^»]+)»\s+на\s+сумму\s+([\d\s.,]+?)\s*${CURRENCY}`, 'i')
const SALE_PRODUCT = /Товар:\s*(.+?)\s*(?=Сумма:|Контакт покупателя|$)/i
const SALE_SUM = new RegExp(String.raw`Сумма:\s*([\d\s.,]+?)\s*${CURRENCY}`, 'i')
const NEW_SALE = /новая продажа/i

/** «300.00», «1 500,00», «1,500.00» → the number. */
function readAmount(written: string) {
  let digits = written.replace(/\s/g, '')
  if (digits.includes(',') && digits.includes('.')) digits = digits.replace(/,/g, '')
  const amount = Number(digits.replace(',', '.'))
  return Number.isFinite(amount) && amount > 0 ? amount : undefined
}

/** A «Новая продажа» letter of BZB, or undefined for any other letter. */
export function readBezebeeSaleMail(mail: MailMessage): BezebeeSaleMail | undefined {
  if (!mail.fromAddress || !BEZEBEE.test(mail.fromAddress.split('@').pop() ?? '')) return undefined
  const text = mail.text.replace(/\s+/g, ' ')
  const newSale = NEW_SALE.test(mail.subject) || NEW_SALE.test(text)
  const sentence = SALE_SENTENCE.exec(text)
  const lines = !sentence && newSale ? SALE_SUM.exec(text) : null
  const sale = sentence ? { product: sentence[1], amount: sentence[2], currency: sentence[3] }
    : lines ? { product: SALE_PRODUCT.exec(text)?.[1], amount: lines[1], currency: lines[2] } : undefined
  if (!sale && !newSale) return undefined
  const product = sale?.product?.trim() || /«([^»]+)»/.exec(mail.subject)?.[1]
  const amount = sale ? readAmount(sale.amount) : undefined
  const currency = sale ? (/^(₽|руб)/i.test(sale.currency) ? 'RUB' : sale.currency === '$' ? 'USD' : sale.currency.toUpperCase()) : undefined
  const contact = /Контакт покупателя:?\s*(\S+)/i.exec(text)?.[1]
  const email = (contact && EMAIL.exec(contact)?.[0]) ?? undefined
  const telegram = !email && contact ? (/(?:t\.me\/|@)([A-Za-z0-9_]{3,64})/.exec(contact)?.[0] ?? contact).slice(0, 64) : undefined
  const tariff = amount ? bezebeeTariffByAmount(amount, currency) : undefined
  const key = `mail:${mail.messageId ?? createHash('sha256').update(`${mail.subject}\n${mail.text}`).digest('hex')}`
  const notice: BezebeeNotice = {
    paymentId: key.slice(0, 120),
    ...(email ? { email: email.toLowerCase() } : {}),
    ...(telegram ? { telegram } : {}),
    status: sale && amount ? 'paid' : 'unknown',
    ...(amount ? { amount } : {}),
    ...(currency ? { currency } : {}),
    tariff,
  }
  const date = mail.header('date')
  return {
    key,
    verified: vouchedByGmail(mail),
    notice,
    summary: { source: 'e-mail', from: mail.fromAddress, subject: mail.subject, ...(date ? { date } : {}), ...(mail.messageId ? { messageId: mail.messageId } : {}), ...(product ? { product } : {}), text: mail.text.slice(0, 2000), authenticationResults: mail.header('authentication-results') ?? null },
  }
}

const STATE = `
  CREATE TABLE IF NOT EXISTS bezebee_mail_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    uid_validity INTEGER,
    last_uid INTEGER NOT NULL DEFAULT 0,
    checked_at INTEGER,
    error TEXT,
    read_total INTEGER NOT NULL DEFAULT 0,
    reader INTEGER NOT NULL DEFAULT 1);
`

/** The first check looks this far back (the sales before the mailbox was connected). */
const FIRST_LOOK_BACK_MS = 3 * 86_400_000
/**
 * The version of readBezebeeSaleMail. A newer one reads the mailbox again from the first look back, so a sale an older
 * one could not read is applied after the update (2: «Товар: … / Сумма: …», the owner's test sale of 20.10.2026).
 */
const MAIL_READER = 2

type Row = Record<string, unknown>

/** The project mailbox with BZB's sale letters, checked every minute. */
export class BezebeeMailbox {
  private running: Promise<unknown> | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly db: DatabaseSync,
    private readonly credentials: BezebeeCredentialStore,
    private readonly webhooks: BezebeeWebhooks,
    private readonly options: { now?: () => number; host?: string; port?: number; connect?: ImapOptions['connect'] } = {},
  ) {
    this.db.exec(STATE)
    const columns = (this.db.prepare('PRAGMA table_info(bezebee_mail_state)').all() as Row[]).map((column) => String(column.name))
    if (!columns.includes('reader')) this.db.exec('ALTER TABLE bezebee_mail_state ADD COLUMN reader INTEGER NOT NULL DEFAULT 1')
  }

  private now() { return this.options.now?.() ?? Date.now() }

  private state() {
    return (this.db.prepare('SELECT * FROM bezebee_mail_state WHERE id = 1').get() as Row | undefined) ?? { last_uid: 0, read_total: 0 }
  }

  status() {
    const { mailUser, mailPassword } = this.credentials.load()
    const state = this.state()
    return {
      configured: Boolean(mailUser && mailPassword),
      ...(mailUser ? { user: mailUser } : {}),
      ...(state.checked_at ? { checkedAt: new Date(Number(state.checked_at)).toISOString() } : {}),
      ...(state.error ? { error: String(state.error) } : {}),
      read: Number(state.read_total ?? 0),
    }
  }

  /** «Проверить почту сейчас», and the minute timer: one check at a time. */
  check() {
    this.running ??= this.run().finally(() => { this.running = null })
    return this.running.then(() => this.status())
  }

  private async run() {
    const { mailUser, mailPassword } = this.credentials.load()
    if (!mailUser || !mailPassword) return
    const state = this.state()
    let error: string | null = null
    let lastUid = Number(state.last_uid ?? 0)
    let uidValidity = state.uid_validity == null ? null : Number(state.uid_validity)
    const reread = Number(state.reader ?? MAIL_READER) < MAIL_READER
    let read = 0
    try {
      const result = await fetchNewMessages({
        host: this.options.host ?? 'imap.gmail.com',
        port: this.options.port ?? 993,
        user: mailUser,
        // Gmail shows an app password in groups of four.
        password: mailPassword.replace(/\s+/g, ''),
        from: BEZEBEE_SENDER_DOMAIN,
        afterUid: uidValidity === null || reread ? 0 : lastUid,
        ...(uidValidity !== null ? { uidValidity } : {}),
        since: new Date(this.now() - FIRST_LOOK_BACK_MS),
        ...(this.options.connect ? { connect: this.options.connect } : {}),
      })
      if (uidValidity !== result.uidValidity) lastUid = 0
      uidValidity = result.uidValidity
      for (const message of result.messages) {
        const sale = readBezebeeSaleMail(parseMail(message.raw))
        if (sale) this.webhooks.receiveSale(sale)
        lastUid = Math.max(lastUid, message.uid)
        read++
      }
    } catch (failure) {
      error = failure instanceof ImapError ? failure.message : `Почта не прочитана: ${failure instanceof Error ? failure.message : 'неизвестная ошибка'}`
    }
    // A failed check keeps the old reader version: the next one reads the mailbox again.
    const reader = error && reread ? Number(state.reader) : MAIL_READER
    this.db.prepare(`INSERT INTO bezebee_mail_state (id, uid_validity, last_uid, checked_at, error, read_total, reader) VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET uid_validity = excluded.uid_validity, last_uid = excluded.last_uid, checked_at = excluded.checked_at, error = excluded.error, read_total = bezebee_mail_state.read_total + ?, reader = excluded.reader`)
      .run(uidValidity, lastUid, this.now(), error, read, reader, read)
  }

  /** A new address or password: the next check starts over (the first look back). */
  reset() { this.db.prepare('DELETE FROM bezebee_mail_state').run() }

  start(everyMs: number) {
    if (this.timer) return
    this.timer = setInterval(() => { void this.check() }, everyMs)
    this.timer.unref?.()
    void this.check()
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }
}
