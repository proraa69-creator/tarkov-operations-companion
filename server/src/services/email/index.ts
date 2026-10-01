/**
 * E-mail configuration from the environment. The owner enters the provider and its key in the laptop app
 * (electron/ownerAdmin.ts, «Почта: коды подтверждения», key encrypted with safeStorage) and the app passes them to the
 * API process as these variables — never through the website or its admin panel, so a stolen owner web session cannot
 * redirect one-time codes.
 *
 *   TARKOV_EMAIL_PROVIDER        resend   (missing → e-mail codes are switched off; registration works as before)
 *   TARKOV_EMAIL_API_KEY         Resend API key (re_…, «Sending access» is enough)
 *   TARKOV_EMAIL_FROM            sender, default `Raid OS <noreply@raidos.app>` (the domain must be verified at Resend)
 *   TARKOV_EMAIL_DAILY_LIMIT     e-mails for the whole service per 24 h (default 500)
 *   TARKOV_EMAIL_ADDRESS_DAILY_LIMIT  codes per address per 24 h (default 10)
 */
import { ResendSender } from './resend.js'
import { EMAIL_PROVIDERS, type EmailMessage, type EmailProviderId, type EmailSender, type FetchLike } from './types.js'

export * from './types.js'

export const DEFAULT_EMAIL_FROM = 'Raid OS <noreply@raidos.app>'

export interface EmailLimits {
  /** E-mails actually sent by the whole service per rolling 24 h (protects the provider quota and reputation). */
  dailyLimit: number
  /** Code requests per e-mail address per rolling 24 h. */
  addressDailyLimit: number
}

export interface EmailConfig extends EmailLimits {
  provider: EmailProviderId
  apiKey: string
  from: string
}

export const DEFAULT_EMAIL_LIMITS: EmailLimits = { dailyLimit: 500, addressDailyLimit: 10 }

const int = (raw: string | undefined, fallback: number, max: number) => {
  const value = Number(raw)
  return raw !== undefined && raw !== '' && Number.isInteger(value) && value >= 1 && value <= max ? value : fallback
}

const FROM = /^(?:[^<>@"\r\n]{1,80} <[^\s<>@]{1,64}@[^\s<>@]{1,190}\.[A-Za-z]{2,}>|[^\s<>@]{1,64}@[^\s<>@]{1,190}\.[A-Za-z]{2,})$/

/** `Name <box@domain>` or `box@domain`; no line breaks (header injection), sane length. */
export function validFrom(raw: string | undefined) {
  const value = (raw ?? '').trim()
  return value.length <= 200 && FROM.test(value) ? value : undefined
}

export function emailLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): EmailLimits {
  return {
    dailyLimit: int(env.TARKOV_EMAIL_DAILY_LIMIT, DEFAULT_EMAIL_LIMITS.dailyLimit, 1_000_000),
    addressDailyLimit: int(env.TARKOV_EMAIL_ADDRESS_DAILY_LIMIT, DEFAULT_EMAIL_LIMITS.addressDailyLimit, 100),
  }
}

/** undefined when no provider is configured (or its key is missing): e-mail codes stay off. */
export function emailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EmailConfig | undefined {
  const provider = (env.TARKOV_EMAIL_PROVIDER ?? '').trim().toLowerCase() as EmailProviderId
  if (!EMAIL_PROVIDERS.includes(provider)) return undefined
  const apiKey = (env.TARKOV_EMAIL_API_KEY ?? '').trim()
  if (!apiKey) return undefined
  return { provider, apiKey, from: validFrom(env.TARKOV_EMAIL_FROM) ?? DEFAULT_EMAIL_FROM, ...emailLimitsFromEnv(env) }
}

export function createEmailSender(config: EmailConfig, fetch?: FetchLike): EmailSender {
  return new ResendSender({ apiKey: config.apiKey, from: config.from, fetch })
}

/** Test double: keeps the messages in memory (tests read the code from them). */
export class FakeEmailSender implements EmailSender {
  readonly provider = 'fake' as const
  readonly from = DEFAULT_EMAIL_FROM
  readonly sent: EmailMessage[] = []
  fail = false
  async send(message: EmailMessage) {
    if (this.fail) throw new Error('fake failure')
    this.sent.push(message)
    return { id: String(this.sent.length) }
  }
  /** Messages to `to` (all when omitted). */
  to(to?: string) {
    return this.sent.filter((entry) => !to || entry.to === to)
  }
  /** The 6-digit code of the last message to `to`. */
  lastCode(to?: string) {
    const message = this.to(to).at(-1)
    return /\b(\d{6})\b/.exec(message?.text ?? '')?.[1]
  }
}
