/**
 * SMSC.ru (https://smsc.ru/api/http/send/sms/). NOT verified live: written from the public documentation and open
 * client libraries, the sandbox where this code was written cannot reach smsc.ru.
 *
 *   POST https://smsc.ru/sys/send.php   form: login, psw, phones=79991234567, mes, charset=utf-8, fmt=3, [sender]
 *   -> { "id": 1234, "cnt": 1 }   |   { "error": "…", "error_code": 2 }
 */
import { providerNumber, sendFailure, SMS_TIMEOUT_MS, SmsSendError, type FetchLike, type SmsSender } from './types.js'

type Answer = { id?: unknown; cnt?: unknown; error?: unknown; error_code?: unknown }

export class SmscSender implements SmsSender {
  readonly provider = 'smsc' as const
  private readonly login: string
  private readonly password: string
  private readonly sender?: string
  private readonly fetch: FetchLike

  constructor(options: { login: string; password: string; sender?: string; fetch?: FetchLike }) {
    this.login = options.login
    this.password = options.password
    this.sender = options.sender || undefined
    this.fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike)
  }

  async send(phone: string, text: string) {
    const body = new URLSearchParams({ login: this.login, psw: this.password, phones: providerNumber(phone), mes: text, charset: 'utf-8', fmt: '3', ...(this.sender ? { sender: this.sender } : {}) })
    let data: Answer
    try {
      const response = await this.fetch('https://smsc.ru/sys/send.php', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: AbortSignal.timeout(SMS_TIMEOUT_MS) })
      if (!response.ok) throw new SmsSendError('smsc', `SMSC.ru: HTTP ${response.status}`, String(response.status))
      data = await response.json() as Answer
    } catch (error) {
      throw sendFailure('smsc', error, 'SMSC.ru недоступен')
    }
    if (!data || data.error !== undefined || data.id === undefined) throw new SmsSendError('smsc', 'SMSC.ru отклонил запрос', String(data?.error_code ?? ''))
    return { id: String(data.id) }
  }
}
