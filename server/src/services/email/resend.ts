/**
 * Resend (https://resend.com/docs/api-reference/emails/send-email). NOT verified live: written from the public
 * documentation; the sandbox where this code was written cannot reach api.resend.com.
 *
 *   POST https://api.resend.com/emails
 *   Authorization: Bearer re_…            Content-Type: application/json
 *   { "from": "Raid OS <noreply@raidos.app>", "to": ["user@example.com"], "subject": "…", "html": "…", "text": "…" }
 *   -> 200 { "id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }
 *   errors: 4xx/5xx { "statusCode": 422, "name": "validation_error", "message": "…" }
 *           (401 missing_api_key, 403 invalid_api_key / domain not verified, 422 validation_error, 429 rate limit)
 *
 * The key needs only «Sending access». No tracking: Resend's open/click tracking is a per-domain setting that is off
 * by default — keep it off (docs/email-codes.md).
 */
import { EMAIL_TIMEOUT_MS, EmailSendError, sendFailure, type EmailMessage, type EmailSender, type FetchLike } from './types.js'

export const RESEND_URL = 'https://api.resend.com/emails'

type Answer = { id?: unknown; name?: unknown; statusCode?: unknown; message?: unknown }

export class ResendSender implements EmailSender {
  readonly provider = 'resend' as const
  readonly from: string
  private readonly apiKey: string
  private readonly fetch: FetchLike

  constructor(options: { apiKey: string; from: string; fetch?: FetchLike }) {
    this.apiKey = options.apiKey
    this.from = options.from
    this.fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike)
  }

  async send(message: EmailMessage) {
    const body = JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, html: message.html, text: message.text })
    let response: Awaited<ReturnType<FetchLike>>
    let data: Answer | null
    try {
      response = await this.fetch(RESEND_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', 'user-agent': 'RaidOS-Server/1.0' },
        body,
        signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
      })
      data = await response.json().catch(() => null) as Answer | null
    } catch (error) {
      throw sendFailure('resend', error, 'Resend недоступен')
    }
    if (!response.ok) {
      // Only the status and Resend's error name (e.g. validation_error) — never its message, which may echo the address.
      const name = typeof data?.name === 'string' && /^[a-z_]{1,40}$/.test(data.name) ? data.name : ''
      throw new EmailSendError('resend', `Resend отклонил письмо (HTTP ${response.status}${name ? `, ${name}` : ''})`, String(response.status))
    }
    return { id: typeof data?.id === 'string' ? data.id : undefined }
  }
}
