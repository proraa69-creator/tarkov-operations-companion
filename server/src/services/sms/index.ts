/**
 * SMS configuration from the environment. The owner enters the provider and its key in the laptop app (electron/
 * ownerAdmin.ts, encrypted with safeStorage) and the app passes them to the API process as these variables — never
 * through the website or its admin panel, so a stolen owner web session cannot redirect one-time codes.
 *
 *   TARKOV_SMS_PROVIDER        smsru | smsc | smsaero   (missing → phone features are switched off)
 *   TARKOV_SMS_API_KEY         SMS.ru api_id · SMSC.ru password (or API password) · SMS Aero API key
 *   TARKOV_SMS_LOGIN           SMSC.ru login · SMS Aero account e-mail
 *   TARKOV_SMS_SENDER          approved sender name (optional; SMS Aero defaults to «SMS Aero»)
 *   TARKOV_SMS_DAILY_LIMIT     SMS budget for the whole service per 24 h (default 100)
 *   TARKOV_SMS_PHONE_DAILY_LIMIT  code requests per number per 24 h (default 5)
 *   TARKOV_SMS_COUNTRIES       allowed calling codes, comma separated (default "7": Russia and Kazakhstan)
 */
import { SmsAeroSender } from './smsAero.js'
import { SmsRuSender } from './smsRu.js'
import { SmscSender } from './smsc.js'
import { SMS_PROVIDERS, type FetchLike, type SmsProviderId, type SmsSender } from './types.js'

export * from './types.js'

export interface SmsLimits {
  /** SMS actually sent by the whole service per rolling 24 h (anti SMS-pumping budget). */
  dailyLimit: number
  /** Code requests per phone number per rolling 24 h. */
  phoneDailyLimit: number
  /** Allowed country calling codes, e.g. ['7']. */
  countries: string[]
}

export interface SmsConfig extends SmsLimits {
  provider: SmsProviderId
  apiKey: string
  login?: string
  sender?: string
}

export const DEFAULT_SMS_LIMITS: SmsLimits = { dailyLimit: 100, phoneDailyLimit: 5, countries: ['7'] }

const int = (raw: string | undefined, fallback: number, max: number) => {
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 && value <= max ? value : fallback
}

export function parseCountries(raw: string | undefined) {
  const list = [...new Set((raw ?? '').split(/[\s,;]+/).map((value) => value.replace(/^\+/, '').trim()).filter((value) => /^[1-9]\d{0,2}$/.test(value)))]
  return list.length ? list : [...DEFAULT_SMS_LIMITS.countries]
}

export function smsLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): SmsLimits {
  return {
    dailyLimit: int(env.TARKOV_SMS_DAILY_LIMIT, DEFAULT_SMS_LIMITS.dailyLimit, 100_000),
    phoneDailyLimit: Math.max(1, int(env.TARKOV_SMS_PHONE_DAILY_LIMIT, DEFAULT_SMS_LIMITS.phoneDailyLimit, 50)),
    countries: parseCountries(env.TARKOV_SMS_COUNTRIES),
  }
}

/** undefined when no provider is configured (or its credentials are incomplete): phone features stay off. */
export function smsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmsConfig | undefined {
  const provider = (env.TARKOV_SMS_PROVIDER ?? '').trim().toLowerCase() as SmsProviderId
  if (!SMS_PROVIDERS.includes(provider)) return undefined
  const apiKey = (env.TARKOV_SMS_API_KEY ?? '').trim()
  const login = (env.TARKOV_SMS_LOGIN ?? '').trim()
  if (!apiKey) return undefined
  if ((provider === 'smsc' || provider === 'smsaero') && !login) return undefined
  const sender = (env.TARKOV_SMS_SENDER ?? '').trim().slice(0, 32)
  return { provider, apiKey, ...(login ? { login } : {}), ...(sender ? { sender } : {}), ...smsLimitsFromEnv(env) }
}

export function createSmsSender(config: SmsConfig, fetch?: FetchLike): SmsSender {
  if (config.provider === 'smsru') return new SmsRuSender({ apiId: config.apiKey, from: config.sender, fetch })
  if (config.provider === 'smsc') return new SmscSender({ login: config.login ?? '', password: config.apiKey, sender: config.sender, fetch })
  return new SmsAeroSender({ email: config.login ?? '', apiKey: config.apiKey, sign: config.sender, fetch })
}

/** Test double: keeps the messages in memory (tests read the code from them). */
export class FakeSmsSender implements SmsSender {
  readonly provider = 'fake' as const
  readonly sent: Array<{ phone: string; text: string }> = []
  fail = false
  async send(phone: string, text: string) {
    if (this.fail) throw new Error('fake failure')
    this.sent.push({ phone, text })
    return { id: String(this.sent.length) }
  }
  /** The 6-digit code of the last message to `phone`. */
  lastCode(phone?: string) {
    const message = [...this.sent].reverse().find((entry) => !phone || entry.phone === phone)
    return /\b(\d{6})\b/.exec(message?.text ?? '')?.[1]
  }
}
