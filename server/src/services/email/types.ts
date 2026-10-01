/**
 * Pluggable e-mail sending for one-time codes and account notices (services/emailAuth.ts).
 *
 * A sender gets one recipient and a ready message. It must never log the address, the message (it holds the code) or
 * its API key; errors carry only the provider name and the provider's HTTP status / error name.
 *
 * Providers: Resend (resend.ts). To add another one (e.g. Unisender Go), implement `EmailSender`, add its id to
 * EMAIL_PROVIDERS and a branch in createEmailSender (index.ts) — nothing else changes.
 */
export type EmailProviderId = 'resend'
export const EMAIL_PROVIDERS: readonly EmailProviderId[] = ['resend']

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

export interface EmailSender {
  readonly provider: EmailProviderId | 'fake'
  /** The «From» header, e.g. `Raid OS <noreply@raidos.app>`. */
  readonly from: string
  /** Resolves when the provider accepted the message; rejects with `EmailSendError` otherwise. */
  send(message: EmailMessage): Promise<{ id?: string }>
}

export class EmailSendError extends Error {
  readonly provider: string
  readonly code?: string
  constructor(provider: string, message: string, code?: string) {
    super(message)
    this.provider = provider
    this.code = code
  }
}

/** `fetch` is injectable so providers can be unit-tested without the network. */
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export const EMAIL_TIMEOUT_MS = 10_000

/** Wraps a network / parse failure; an `EmailSendError` passes through unchanged. Never includes the request. */
export function sendFailure(provider: string, error: unknown, unavailable: string) {
  return error instanceof EmailSendError ? error : new EmailSendError(provider, unavailable)
}
