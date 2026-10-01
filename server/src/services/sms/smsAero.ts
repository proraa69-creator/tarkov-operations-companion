/**
 * SMS Aero, API v2 (https://smsaero.ru/integration/documentation/api/). NOT verified live: written from the public
 * documentation and the official client libraries, the sandbox where this code was written cannot reach smsaero.ru.
 *
 *   POST https://gate.smsaero.ru/v2/sms/send   Basic auth <account e-mail>:<API key>
 *        form: number=79991234567, text, sign=<approved sender name, «SMS Aero» by default>
 *   -> { "success": true, "data": { "id": 1, "status": 8, … }, "message": null }   |   { "success": false, "message": "…" }
 */
import { providerNumber, sendFailure, SMS_TIMEOUT_MS, SmsSendError, type FetchLike, type SmsSender } from './types.js'

export const SMS_AERO_DEFAULT_SIGN = 'SMS Aero'
type Answer = { success?: unknown; data?: { id?: unknown } }

export class SmsAeroSender implements SmsSender {
  readonly provider = 'smsaero' as const
  private readonly email: string
  private readonly apiKey: string
  private readonly sign: string
  private readonly fetch: FetchLike

  constructor(options: { email: string; apiKey: string; sign?: string; fetch?: FetchLike }) {
    this.email = options.email
    this.apiKey = options.apiKey
    this.sign = options.sign || SMS_AERO_DEFAULT_SIGN
    this.fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike)
  }

  async send(phone: string, text: string) {
    const body = new URLSearchParams({ number: providerNumber(phone), text, sign: this.sign })
    const authorization = `Basic ${Buffer.from(`${this.email}:${this.apiKey}`).toString('base64')}`
    let data: Answer
    try {
      const response = await this.fetch('https://gate.smsaero.ru/v2/sms/send', { method: 'POST', headers: { authorization, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: body.toString(), signal: AbortSignal.timeout(SMS_TIMEOUT_MS) })
      if (response.status === 401) throw new SmsSendError('smsaero', 'SMS Aero: неверный e-mail или API-ключ', '401')
      data = await response.json().catch(() => ({})) as Answer
      if (!response.ok && data?.success !== false) throw new SmsSendError('smsaero', `SMS Aero: HTTP ${response.status}`, String(response.status))
    } catch (error) {
      throw sendFailure('smsaero', error, 'SMS Aero недоступен')
    }
    if (data?.success !== true) throw new SmsSendError('smsaero', 'SMS Aero отклонил запрос')
    return { id: data.data?.id === undefined ? undefined : String(data.data.id) }
  }
}
