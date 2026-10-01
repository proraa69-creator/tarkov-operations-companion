/**
 * SMS.ru (https://sms.ru/api/send). NOT verified live: written from the public documentation, the sandbox where this
 * code was written cannot reach sms.ru.
 *
 *   POST https://sms.ru/sms/send   form: api_id, to=79991234567, msg, json=1, [from=<approved sender name>]
 *   -> { "status": "OK", "status_code": 100, "sms": { "79991234567": { "status": "OK", "status_code": 100, "sms_id": "…" } }, "balance": 1.23 }
 *   errors: "status": "ERROR" with a status_code (e.g. 200 wrong api_id, 201 not enough money), at the top or per number.
 */
import { providerNumber, sendFailure, SMS_TIMEOUT_MS, SmsSendError, type FetchLike, type SmsSender } from './types.js'

type Answer = { status?: unknown; status_code?: unknown; sms?: Record<string, { status?: unknown; status_code?: unknown; sms_id?: unknown }> }

export class SmsRuSender implements SmsSender {
  readonly provider = 'smsru' as const
  private readonly apiId: string
  private readonly from?: string
  private readonly fetch: FetchLike

  constructor(options: { apiId: string; from?: string; fetch?: FetchLike }) {
    this.apiId = options.apiId
    this.from = options.from || undefined
    this.fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike)
  }

  async send(phone: string, text: string) {
    const to = providerNumber(phone)
    const body = new URLSearchParams({ api_id: this.apiId, to, msg: text, json: '1', ...(this.from ? { from: this.from } : {}) })
    let data: Answer
    try {
      const response = await this.fetch('https://sms.ru/sms/send', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: AbortSignal.timeout(SMS_TIMEOUT_MS) })
      if (!response.ok) throw new SmsSendError('smsru', `SMS.ru: HTTP ${response.status}`, String(response.status))
      data = await response.json() as Answer
    } catch (error) {
      throw sendFailure('smsru', error, 'SMS.ru недоступен')
    }
    if (data?.status !== 'OK') throw new SmsSendError('smsru', 'SMS.ru отклонил запрос', String(data?.status_code ?? ''))
    const entry = data.sms?.[to]
    if (entry && entry.status !== 'OK') throw new SmsSendError('smsru', 'SMS.ru не принял сообщение', String(entry.status_code ?? ''))
    return { id: typeof entry?.sms_id === 'string' ? entry.sms_id : undefined }
  }
}
